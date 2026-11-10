import { authenticatedEmail, parseCookies, verifyWriteOrigin } from './security';
import { githubRequest, repoPath, type GitHubEnv } from './github';
import { checkArticle, createMarkdown, safeArticleSlug } from './content';

interface D1Result<T = Record<string, unknown>> { results: T[]; success: boolean; meta: { changes: number }; }
interface D1Database { prepare(query: string): { bind(...values: unknown[]): any; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<D1Result<T>>; run<T = unknown>(): Promise<D1Result<T>> }; batch<T = unknown>(statements: unknown[]): Promise<T[]>; }
interface R2Object { key: string; size: number; uploaded: Date; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string>; }
interface R2Bucket { put(key: string, value: ArrayBuffer | ArrayBufferView | ReadableStream, options?: unknown): Promise<R2Object>; get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> } | null>; list(options?: unknown): Promise<{ objects: R2Object[]; truncated: boolean; cursor?: string }>; delete(key: string): Promise<void>; }
interface Env extends GitHubEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB?: D1Database;
  PRIVATE_MEDIA?: R2Bucket;
  ACCESS_TEAM?: string;
  ACCESS_AUD?: string;
  ACCESS_ALLOWED_EMAIL?: string;
  ENVIRONMENT?: string;
  LOCAL_DEV_EMAIL?: string;
  GITHUB_BASE_BRANCH: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_APP_ID: string;
  GITHUB_INSTALLATION_ID: string;
  GITHUB_PRIVATE_KEY: string;
}

const json = (data: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers } });
const idPattern = /^[a-zA-Z0-9_-]{8,80}$/;
const allowedSection = new Set(['life', 'tech']);

function requireDb(env: Env): D1Database { if (!env.DB) throw new Error('D1 binding DB is not configured'); return env.DB; }
async function consumeRate(env: Env, user: string, path: string) {
  const db = requireDb(env); const now = Date.now(); const hour = Math.floor(now / 3_600_000) * 3_600_000;
  const isUpload = path === '/api/media'; const isPublish = path === '/api/publish'; const limit = isUpload ? 60 : isPublish ? 5 : 240;
  const key = `${user.toLowerCase()}:${isUpload ? 'upload' : isPublish ? 'publish' : 'write'}`;
  const row = await db.prepare('INSERT INTO rate_limits(identity, window_start, count) VALUES (?, ?, 1) ON CONFLICT(identity) DO UPDATE SET count = CASE WHEN window_start < ? THEN 1 ELSE count + 1 END, window_start = CASE WHEN window_start < ? THEN ? ELSE window_start END RETURNING count').bind(key, hour, hour, hour, hour).first<{count:number}>();
  if ((row?.count || 0) > limit) { const error = new Error('Too many requests. Please wait before trying again.') as Error & {status:number}; error.status = 429; throw error; }
}
function requireR2(env: Env): R2Bucket { if (!env.PRIVATE_MEDIA) throw new Error('R2 binding PRIVATE_MEDIA is not configured'); return env.PRIVATE_MEDIA; }

async function readJson(request: Request, maxBytes = 2_000_000): Promise<any> {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > maxBytes) throw new Error('Request body exceeds the allowed size');
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new Error('Request body exceeds the allowed size');
  return JSON.parse(raw);
}

function corsafePath(path: string) { return `/${path.split('/').map(encodeURIComponent).join('/')}`; }
async function githubPosts(env: Env) {
  const { GITHUB_OWNER, GITHUB_REPO, GITHUB_BASE_BRANCH } = env;
  const path = `/repos/${encodeURIComponent(GITHUB_OWNER)}/${encodeURIComponent(GITHUB_REPO)}/git/trees/${encodeURIComponent(GITHUB_BASE_BRANCH)}?recursive=1`;
  const result = await (await githubRequest(env, path)).json() as { tree: Array<{ path: string; type: string; sha: string; size?: number }> };
  const files = result.tree.filter((item) => item.type === 'blob' && /^src\/content\/(life|tech)\/[^/]+\.mdx?$/.test(item.path));
  return files.map(({ path, sha, size }) => ({ path, sha, size }));
}
async function githubRead(env: Env, path: string, ref = env.GITHUB_BASE_BRANCH) {
  path = repoPath(path);
  const response = await githubRequest(env, `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/contents${corsafePath(path)}?ref=${encodeURIComponent(ref)}`);
  const data = await response.json() as { content?: string; sha: string; encoding?: string; path: string };
  if (data.encoding !== 'base64' || !data.content) throw new Error('GitHub content response was not Base64 encoded');
  const binary = atob(data.content.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return { path: data.path, sha: data.sha, content: new TextDecoder().decode(bytes) };
}
async function privateMedia(request: Request, env: Env, url: URL) {
  const bucket = requireR2(env);
  if (url.pathname === '/api/media/object' && request.method === 'GET') {
    const key = url.searchParams.get('key') || '';
    if (!/^private\/[a-f0-9-]{36}\.webp$/.test(key)) return json({ error: 'Invalid private media key' }, 400);
    const object = await bucket.get(key);
    if (!object) return json({ error: 'Media not found' }, 404);
    return new Response(object.body, { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (request.method === 'POST') {
    const type = request.headers.get('Content-Type') || '';
    if (type !== 'image/webp') return json({ error: 'Upload only optimized image/webp files' }, 415);
    const length = Number(request.headers.get('Content-Length') || 0);
    if (length < 16 || length > 8 * 1024 * 1024) return json({ error: 'Image must be below 8 MB' }, 413);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength < 16 || bytes.byteLength > 8 * 1024 * 1024) return json({ error: 'Image must be below 8 MB' }, 413);
    const head = new Uint8Array(bytes.slice(0, 12));
    if (new TextDecoder().decode(head.slice(0, 4)) !== 'RIFF' || new TextDecoder().decode(head.slice(8, 12)) !== 'WEBP') return json({ error: 'Invalid WebP signature' }, 415);
    const key = `private/${crypto.randomUUID()}.webp`;
    await bucket.put(key, bytes, { httpMetadata: { contentType: 'image/webp', cacheControl: 'private, no-store' }, customMetadata: { uploadedAt: new Date().toISOString() } });
    await requireDb(env).prepare('INSERT INTO media (key, alt, caption, created_at) VALUES (?, ?, ?, ?)').bind(key, '', '', new Date().toISOString()).run();
    return json({ key, private: true });
  }
  if (request.method === 'GET') {
    const { results } = await requireDb(env).prepare('SELECT key, alt, caption, created_at FROM media ORDER BY created_at DESC LIMIT 500').all();
    return json(results);
  }
  if (request.method === 'DELETE') {
    const key = url.searchParams.get('key') || '';
    if (!/^private\/[a-f0-9-]{36}\.webp$/.test(key)) return json({ error: 'Invalid private media key' }, 400);
    await bucket.delete(key);
    await requireDb(env).prepare('DELETE FROM media WHERE key = ?').bind(key).run();
    return json({ deleted: true });
  }
  return json({ error: 'Method not allowed' }, 405);
}

async function publish(env: Env, draftId: string, user: string, confirm: boolean) {
  if (!confirm) throw new Error('Explicit publish confirmation is required');
  const db = requireDb(env);
  const draft = await db.prepare('SELECT * FROM drafts WHERE id = ?').bind(draftId).first<any>();
  if (!draft) throw new Error('Draft not found');
  const data = JSON.parse(draft.data_json);
  checkArticle(data);
  const extension = data.extension === '.mdx' ? '.mdx' : '.md';
  const path = repoPath(`src/content/${data.section}/${data.slug}${extension}`);
  const base = env.GITHUB_BASE_BRANCH;
  const ref = await (await githubRequest(env, `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/git/ref/heads/${encodeURIComponent(base)}`)).json() as any;
  const baseSha = String(ref.object?.sha || '');
  if (!/^[a-f0-9]{40}$/.test(baseSha)) throw new Error('Could not resolve GitHub base branch SHA');
  let currentBlobSha: string | null = null;
  try { currentBlobSha = (await githubRead(env, path, base)).sha; } catch (error) { if (!(error instanceof Error && /404|Not Found/.test(error.message))) throw error; }
  if (draft.github_sha && draft.github_sha !== currentBlobSha) throw new Error('GitHub article changed since it was loaded. Reload it and resolve the conflict first.');
  if (!draft.github_sha && currentBlobSha) throw new Error('That article path already exists in GitHub');
  const generated = createMarkdown(data);
  const treeEntries: Array<Record<string, string>> = [{ path, mode: '100644', type: 'blob', content: generated.text }];
  for (const key of generated.mediaKeys) {
    const image = await requireR2(env).get(key);
    if (!image) throw new Error(`Private image is missing: ${key}`);
    const bytes = new Uint8Array(await new Response(image.body).arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    treeEntries.push({ path: `public/images/${key.slice('private/'.length)}`, mode: '100644', type: 'blob', content: btoa(binary) });
  }
  const treeResponse = await githubRequest(env, `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: baseSha, tree: treeEntries }) });
  const tree = await treeResponse.json() as any;
  const commitResponse = await githubRequest(env, `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/git/commits`, { method: 'POST', body: JSON.stringify({ message: `Studio: ${data.title}`, tree: tree.sha, parents: [baseSha] }) });
  const commit = await commitResponse.json() as any;
  const branch = `studio/${data.section}-${data.slug}-${crypto.randomUUID().slice(0, 8)}`;
  await githubRequest(env, `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }) });
  const prResponse = await githubRequest(env, `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/pulls`, { method: 'POST', body: JSON.stringify({ title: `发布文章：${data.title}`, head: branch, base, body: `由 TingWoShuo Studio 为 ${user} 创建。\n\n目标文件：\`${path}\`\n\n合并后由 Cloudflare Pages 自动构建。` }) });
  const pr = await prResponse.json() as any;
  const now = new Date().toISOString();
  await db.prepare('INSERT INTO publish_jobs (id, draft_id, status, github_branch, github_commit, pull_request_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), draftId, 'pr-open', branch, commit.sha, pr.html_url, now, now).run();
  return { status: 'pr-open', branch, commit: commit.sha, pullRequest: pr.html_url, target: path };
}

async function api(request: Request, env: Env, user: string): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === '/api/session' && request.method === 'GET') {
    const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
    const secure = env.ENVIRONMENT === 'production' ? '; Secure' : '';
    return json({ email: user, csrf: token }, 200, { 'Set-Cookie': `studio_csrf=${token}; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=3600` });
  }
  if (path === '/api/drafts' && request.method === 'GET') {
    const { results } = await requireDb(env).prepare('SELECT id, revision, status, title, section, slug, updated_at, github_path, github_sha FROM drafts ORDER BY updated_at DESC').all();
    return json(results);
  }
  if (path === '/api/drafts' && request.method === 'POST') {
    const input = await readJson(request); checkArticle(input);
    const db = requireDb(env); const id = crypto.randomUUID(); const now = new Date().toISOString();
    const data = { ...input, mdx: Boolean(input.mdx) }; delete data.doc;
    await db.batch([
      db.prepare('INSERT INTO drafts (id, revision, status, title, section, slug, data_json, doc_json, github_path, github_sha, updated_at, updated_by) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, input.published ? 'published' : 'draft', input.title, input.section, input.slug, JSON.stringify(data), JSON.stringify(input.doc || {}), input.githubPath || null, input.githubSha || null, now, user),
      db.prepare('INSERT INTO draft_versions (draft_id, revision, data_json, doc_json, created_at, created_by) VALUES (?, 1, ?, ?, ?, ?)').bind(id, JSON.stringify(data), JSON.stringify(input.doc || {}), now, user)
    ]);
    return json({ id, revision: 1, updatedAt: now }, 201);
  }
  const draftMatch = path.match(/^\/api\/drafts\/([a-zA-Z0-9_-]{8,80})$/);
  if (draftMatch && request.method === 'GET') {
    const row = await requireDb(env).prepare('SELECT id, revision, status, data_json, doc_json, github_path, github_sha, updated_at FROM drafts WHERE id = ?').bind(draftMatch[1]).first<any>();
    return row ? json({ ...row, data: JSON.parse(row.data_json), doc: JSON.parse(row.doc_json || '{}') }) : json({ error: 'Draft not found' }, 404);
  }
  if (draftMatch && request.method === 'PUT') {
    const input = await readJson(request); checkArticle(input);
    const revision = Number(request.headers.get('If-Match')?.replaceAll('"', '') || input.revision);
    if (!Number.isInteger(revision) || revision < 1) return json({ error: 'Missing valid revision for conflict detection' }, 428);
    const db = requireDb(env); const now = new Date().toISOString(); const data = { ...input }; delete data.doc; delete data.revision;
    const next = revision + 1;
    const [result] = await db.batch([
      db.prepare('UPDATE drafts SET revision = revision + 1, status = ?, title = ?, section = ?, slug = ?, data_json = ?, doc_json = ?, github_path = COALESCE(?, github_path), github_sha = COALESCE(?, github_sha), updated_at = ?, updated_by = ? WHERE id = ? AND revision = ?')
        .bind(input.published ? 'published' : 'draft', input.title, input.section, input.slug, JSON.stringify(data), JSON.stringify(input.doc || {}), input.githubPath || null, input.githubSha || null, now, user, draftMatch[1], revision),
      db.prepare('INSERT INTO draft_versions (draft_id, revision, data_json, doc_json, created_at, created_by) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM drafts WHERE id = ? AND revision = ?)')
        .bind(draftMatch[1], next, JSON.stringify(data), JSON.stringify(input.doc || {}), now, user, draftMatch[1], next)
    ]) as D1Result[];
    if (result.meta.changes !== 1) return json({ error: 'This draft changed on another device. Reload or restore a version before saving.', conflict: true }, 409);
    return json({ id: draftMatch[1], revision: next, updatedAt: now });
  }
  if (draftMatch && request.method === 'DELETE') {
    const db = requireDb(env); await db.prepare('DELETE FROM drafts WHERE id = ?').bind(draftMatch[1]).run(); return json({ deleted: true });
  }
  const versionsMatch = path.match(/^\/api\/drafts\/([a-zA-Z0-9_-]{8,80})\/versions$/);
  if (versionsMatch && request.method === 'GET') {
    const { results } = await requireDb(env).prepare('SELECT revision, created_at, created_by FROM draft_versions WHERE draft_id = ? ORDER BY revision DESC LIMIT 200').bind(versionsMatch[1]).all(); return json(results);
  }
  const versionMatch = path.match(/^\/api\/drafts\/([a-zA-Z0-9_-]{8,80})\/versions\/(\d+)$/);
  if (versionMatch && request.method === 'GET') {
    const row = await requireDb(env).prepare('SELECT revision, data_json, doc_json, created_at, created_by FROM draft_versions WHERE draft_id = ? AND revision = ?').bind(versionMatch[1], Number(versionMatch[2])).first<any>();
    return row ? json({ ...row, data: JSON.parse(row.data_json), doc: JSON.parse(row.doc_json || '{}') }) : json({ error: 'Version not found' }, 404);
  }
  if (path === '/api/github/posts' && request.method === 'GET') return json(await githubPosts(env));
  const ghPost = path.match(/^\/api\/github\/post$/);
  if (ghPost && request.method === 'GET') {
    const target = url.searchParams.get('path') || ''; return json(await githubRead(env, target));
  }
  if (path === '/api/media' || path === '/api/media/object') return privateMedia(request, env, url);
  if (path === '/api/publish' && request.method === 'POST') {
    const input = await readJson(request); if (input.confirmed !== true) return json({ error: 'Explicit publish confirmation is required' }, 400);
    const id = String(input.draftId || ''); if (!idPattern.test(id)) return json({ error: 'Invalid draft id' }, 400);
    return json(await publish(env, id, user, true), 201);
  }
  if (path === '/api/publish' && request.method === 'GET') {
    const { results } = await requireDb(env).prepare('SELECT id, draft_id, status, github_branch, github_commit, pull_request_url, created_at, updated_at FROM publish_jobs ORDER BY created_at DESC LIMIT 100').all(); return json(results);
  }
  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let user = '';
    try { user = await authenticatedEmail(request, env); }
    catch (error) { return json({ error: error instanceof Error ? error.message : 'Unauthorized' }, 401); }
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS') {
        const cookies = parseCookies(request.headers.get('Cookie'));
        try {
          verifyWriteOrigin(request, cookies.get('studio_csrf') || null, request.headers.get('X-Studio-CSRF'), env.ENVIRONMENT === 'development' ? 'http://127.0.0.1:5180' : new URL(request.url).origin);
        } catch (error) { return json({ error: error instanceof Error ? error.message : 'CSRF rejected' }, 403); }
        try { await consumeRate(env, user, url.pathname); } catch (error) { return json({ error: error instanceof Error ? error.message : 'Rate limit exceeded' }, 429); }
      }
      try { return await api(request, env, user); }
      catch (error) {
        const status = Number((error as any)?.status) || 400;
        return json({ error: error instanceof Error ? error.message : 'Request failed' }, status);
      }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Method not allowed' }, 405);
    const headers = new Headers(request.headers); headers.set('Cache-Control', 'private, no-store');
    const response = await env.ASSETS.fetch(new Request(request, { headers }));
    const resultHeaders = new Headers(response.headers); resultHeaders.set('Cache-Control', 'private, no-store'); resultHeaders.set('X-Content-Type-Options', 'nosniff'); resultHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin'); resultHeaders.set('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    return new Response(response.body, { status: response.status, headers: resultHeaders });
  }
};
