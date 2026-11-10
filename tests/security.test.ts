import { describe, expect, it, vi, afterEach } from 'vitest';
import { authenticatedEmail, parseCookies, verifyWriteOrigin } from '../src/security';
import worker from '../src/worker';

afterEach(() => vi.unstubAllGlobals());

describe('private access boundary', () => {
  it('denies anonymous requests to static assets and API', async () => {
    const response = await worker.fetch(new Request('https://studio.example.workers.dev/'), { ASSETS: { fetch: async () => new Response('private ui') } } as any);
    expect(response.status).toBe(401);
  });
  it('does not trust an email request header as identity', async () => {
    await expect(authenticatedEmail(new Request('https://studio.example.workers.dev/api/session', { headers: { 'Cf-Access-Authenticated-User-Email': 'owner@example.com' } }), { ACCESS_TEAM: 'team', ACCESS_AUD: 'aud', ACCESS_ALLOWED_EMAIL: 'owner@example.com' })).rejects.toThrow('Access authentication required');
  });
  it('rejects invalid Access JWT even when an email header is present', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [] }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })));
    await expect(authenticatedEmail(new Request('https://studio.example.workers.dev/api/session', { headers: { 'Cf-Access-Jwt-Assertion': 'not.a.jwt', 'Cf-Access-Authenticated-User-Email': 'owner@example.com' } }), { ACCESS_TEAM: 'team', ACCESS_AUD: 'aud', ACCESS_ALLOWED_EMAIL: 'owner@example.com' })).rejects.toThrow();
  });
  it('requires exact same-origin and matching CSRF token for writes', () => {
    const req = new Request('https://studio.example.workers.dev/api/drafts', { method: 'POST', headers: { Origin: 'https://attacker.example' } });
    expect(() => verifyWriteOrigin(req, 'a'.repeat(64), 'a'.repeat(64))).toThrow('Invalid request origin');
    const same = new Request('https://studio.example.workers.dev/api/drafts', { method: 'POST', headers: { Origin: 'https://studio.example.workers.dev' } });
    expect(() => verifyWriteOrigin(same, 'a'.repeat(64), 'b'.repeat(64))).toThrow('CSRF validation failed');
    expect(() => verifyWriteOrigin(same, 'a'.repeat(64), 'a'.repeat(64))).not.toThrow();
  });
  it('safely parses cookies', () => expect(parseCookies('a=1; studio_csrf=token').get('studio_csrf')).toBe('token'));
});
