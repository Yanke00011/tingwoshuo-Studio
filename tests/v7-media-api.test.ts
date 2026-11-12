import { describe, expect, it, vi } from 'vitest';
import worker from '../src/worker';

const csrf = 'c'.repeat(64);
const webp = new Uint8Array([82, 73, 70, 70, 20, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32, 0, 0, 0, 0]);

function uploadRequest() {
  return new Request('http://127.0.0.1:5180/api/media', {
    method: 'POST',
    headers: {
      Origin: 'http://127.0.0.1:5180',
      Cookie: `studio_csrf=${csrf}`,
      'X-Studio-CSRF': csrf,
      'Content-Type': 'image/webp',
      'Content-Length': String(webp.byteLength),
    },
    body: webp,
  });
}

function mockDb({ failInsert = false } = {}) {
  const rows = new Set<string>();
  const prepare = vi.fn((query: string) => {
    let bound: unknown[] = [];
    const statement = {
      bind: (...values: unknown[]) => { bound = values; return statement; },
      first: async () => ({ count: 1 }),
      all: async () => ({ results: [], success: true, meta: { changes: 0 } }),
      run: async () => {
        if (query.startsWith('INSERT INTO media')) {
          if (failInsert) throw new Error('Injected D1 media insert failure');
          rows.add(String(bound[0]));
        }
        if (query.startsWith('DELETE FROM media')) rows.delete(String(bound[0]));
        return { success: true, meta: { changes: 1 } };
      },
    };
    return statement;
  });
  return { db: { prepare, batch: vi.fn() }, prepare, rows };
}

function mockR2({ failPut = false } = {}) {
  const objects = new Set<string>();
  const put = vi.fn(async (key: string) => {
    if (failPut) throw new Error('Injected R2 upload failure');
    objects.add(key);
    return { key, size: webp.byteLength, uploaded: new Date() };
  });
  const del = vi.fn(async (key: string) => { objects.delete(key); });
  return { bucket: { put, delete: del, get: vi.fn(), list: vi.fn() }, put, del, objects };
}

async function uploadWith(db: ReturnType<typeof mockDb>, r2: ReturnType<typeof mockR2>) {
  const response = await worker.fetch(uploadRequest(), {
    ENVIRONMENT: 'development',
    LOCAL_DEV_EMAIL: 'staging-test@localhost',
    DB: db.db,
    PRIVATE_MEDIA: r2.bucket,
    ASSETS: { fetch: async () => new Response('') },
  } as any);
  return response;
}

describe('staging media upload failure ordering', () => {
  it('registers media metadata before writing the WebP object', async () => {
    const db = mockDb();
    const r2 = mockR2();

    const response = await uploadWith(db, r2);
    const result = await response.json() as { key: string };

    expect(response.status).toBe(200);
    expect(db.rows.has(result.key)).toBe(true);
    expect(r2.objects.has(result.key)).toBe(true);
  });

  it('does not write an R2 object when the D1 media insert fails', async () => {
    const db = mockDb({ failInsert: true });
    const r2 = mockR2();

    const response = await uploadWith(db, r2);

    expect(response.status).toBe(400);
    expect(db.prepare.mock.calls.some(([query]) => query.startsWith('INSERT INTO media'))).toBe(true);
    expect(r2.put).not.toHaveBeenCalled();
    expect(r2.objects.size).toBe(0);
  });

  it('cleans up both sides when R2 rejects the upload after D1 registration', async () => {
    const db = mockDb();
    const r2 = mockR2({ failPut: true });

    const response = await uploadWith(db, r2);

    expect(response.status).toBe(400);
    expect(r2.put).toHaveBeenCalledOnce();
    expect(r2.del).toHaveBeenCalledOnce();
    expect(r2.objects.size).toBe(0);
    expect(db.rows.size).toBe(0);
  });
});
