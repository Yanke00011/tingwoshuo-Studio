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
  CONTENT_BACKEND?: string;
  GITHUB_BASE_BRANCH: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_APP_ID: string;
  GITHUB_INSTALLATION_ID: string;
  GITHUB_PRIVATE_KEY: string;
}

const json = (data: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers } });
const idPattern = /^[a-zA-Z0-9_-]{8,80}$/;

function requireDb(env: Env): D1Database { if (!env.DB) throw new Error('D1 binding DB is not configured'); return env.DB; }
async function consumeRate(env: Env, user: string, path: string) {
  const db = requireDb(env); const now = Date.now(); const hour = Math.floor(now / 3_600_000) * 3_600_000;
  const isUpload = path === '/api/media'; const isPublish = path === '/api/publish'; const isArticleDelete = path === '/api/github/post'; const limit = isUpload ? 60 : isPublish || isArticleDelete ? 5 : 240;
  const key = `${user.toLowerCase()}:${isUpload ? 'upload' : isPublish ? 'publish' : isArticleDelete ? 'delete' : 'write'}`;
  const row: any = await db.prepare('INSERT INTO rate_limits(identity, window_start, count) VALUES (?, ?, 1) ON CONFLICT(identity) DO UPDATE SET count = CASE WHEN window_start < ? THEN 1 ELSE count + 1 END, window_start = CASE WHEN window_start < ? THEN ? ELSE window_start END RETURNING count').bind(key, hour, hour, hour, hour).first();
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
function base64Bytes(bytes: Uint8Array) { let binary = ''; for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192)); return btoa(binary); }
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
    const db = requireDb(env);
    await db.prepare('INSERT INTO media (key, alt, caption, created_at) VALUES (?, ?, ?, ?)').bind(key, '', '', new Date().toISOString()).run();
    try {
      await bucket.put(key, bytes, { httpMetadata: { contentType: 'image/webp', cacheControl: 'private, no-store' }, customMetadata: { uploadedAt: new Date().toISOString() } });
    } catch (error) {
      await Promise.allSettled([
        bucket.delete(key),
        db.prepare('DELETE FROM media WHERE key = ?').bind(key).run(),
      ]);
      throw error;
    }
    return json({ key, private: true });
  }
  if (request.method === 'GET') {
    const { results } = await requireDb(env).prepare('SELECT key, alt, caption, created_at FROM media ORDER BY created_at DESC LIMIT 500').all();
    return json(results);
  }
  if (request.method === 'PATCH') {
    const input = await readJson(request, 12_000); const key = String(input.key || '');
    if (!/^private\/[a-f0-9-]{36}\.webp$/.test(key) || typeof input.alt !== 'string' || input.alt.length > 300 || typeof input.caption !== 'string' || input.caption.length > 500) return json({ error: 'Invalid media metadata' }, 400);
    await requireDb(env).prepare('UPDATE media SET alt = ?, caption = ? WHERE key = ?').bind(input.alt, input.caption, key).run();
    return json({ key, alt: input.alt, caption: input.caption });
  }
  if (request.method === 'DELETE') {
    const key = url.searchParams.get('key') || '';
    if (!/^private\/[a-f0-9-]{36}\.webp$/.test(key)) return json({ error: 'Invalid private media key' }, 400);
    const linked = await requireDb(env).prepare("SELECT key FROM media WHERE key = ? AND (visibility = 'published' OR EXISTS (SELECT 1 FROM article_media WHERE media_key = media.key)) LIMIT 1").bind(key).first();
    if (linked) return json({ error: 'This image is attached to an article version. It is retained so published and recoverable content cannot lose media.' }, 409);
    await bucket.delete(key);
    await requireDb(env).prepare('DELETE FROM media WHERE key = ?').bind(key).run();
    return json({ deleted: true });
  }
  return json({ error: 'Method not allowed' }, 405);
}

async function preparePublish(env: Env, draftId: string) {
  const draft: any = await requireDb(env).prepare('SELECT * FROM drafts WHERE id = ?').bind(draftId).first();
  if (!draft) throw new Error('Draft not found');
  const data = JSON.parse(draft.data_json); checkArticle(data);
  const extension = data.extension === '.mdx' ? '.mdx' : '.md';
  const path = repoPath(`src/content/${data.section}/${data.slug}${extension}`);
  const generated = createMarkdown(data);
  const media = [];
  for (const key of generated.mediaKeys) {
    const object = await requireR2(env).get(key);
    if (!object) throw new Error(`Private image is missing: ${key}`);
    media.push(`public/images/${key.slice('private/'.length)}`);
  }
  return { title: data.title, section: data.section, slug: data.slug, baseBranch: env.GITHUB_BASE_BRANCH, files: [path, ...media], media: generated.mediaKeys };
}

async function publish(env: Env, draftId: string, user: string, confirm: boolean) {
  if (!confirm) throw new Error('Explicit publish confirmation is required');
  const db = requireDb(env);
  const draft: any = await db.prepare('SELECT * FROM drafts WHERE id = ?').bind(draftId).first();
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
  const articleBlobResponse = await githubRequest(env, `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: base64Bytes(new TextEncoder().encode(generated.text)), encoding: 'base64' }) });
  const articleBlob = await articleBlobResponse.json() as { sha: string };
  if (!/^[a-f0-9]{40}$/.test(articleBlob.sha || '')) throw new Error('GitHub did not return a valid published article blob SHA');
  const treeEntries: Array<Record<string, string>> = [{ path, mode: '100644', type: 'blob', sha: articleBlob.sha }];
  for (const key of generated.mediaKeys) {
    const image = await requireR2(env).get(key);
    if (!image) throw new Error(`Private image is missing: ${key}`);
    const bytes = new Uint8Array(await new Response(image.body).arrayBuffer());
    const blobResponse = await githubRequest(env, `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: base64Bytes(bytes), encoding: 'base64' }) });
    const blob = await blobResponse.json() as { sha: string };
    treeEntries.push({ path: `public/images/${key.slice('private/'.length)}`, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const treeResponse = await githubRequest(env, `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: baseSha, tree: treeEntries }) });
  const tree = await treeResponse.json() as { sha: string };
  if (!/^[a-f0-9]{40}$/.test(tree.sha || '')) throw new Error('GitHub did not return a valid commit tree SHA');
  const commitResponse = await githubRequest(env, `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/git/commits`, { method: 'POST', body: JSON.stringify({ message: `Studio: ${data.title}`, tree: tree.sha, parents: [baseSha] }) });
  const commit = await commitResponse.json() as any;
  const articleBlobSha = articleBlob.sha;
  if (!/^[a-f0-9]{40}$/.test(commit.sha || '')) throw new Error('GitHub did not return a valid publish commit SHA');
  try {
    await githubRequest(env, `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/git/refs/heads/${encodeURIComponent(base)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
  } catch (error) {
    if (error instanceof Error && /GitHub API returned (409|422)/.test(error.message)) throw new Error('博客主分支刚刚有新提交，Studio 未覆盖任何内容。请重新打开发布预览后再试。');
    throw error;
  }
  const now = new Date().toISOString();
  const publishedData = { ...data, published: true, githubPath: path, githubSha: articleBlobSha };
  await db.batch([
    db.prepare('UPDATE drafts SET status = ?, github_path = ?, github_sha = ?, data_json = ?, updated_at = ?, updated_by = ? WHERE id = ?').bind('published', path, articleBlobSha, JSON.stringify(publishedData), now, user, draftId),
    db.prepare('INSERT INTO publish_jobs (id, draft_id, status, github_branch, github_commit, pull_request_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), draftId, 'merged', base, commit.sha, '', now, now)
  ]);
  return { status: 'pushed', branch: base, commit: commit.sha, commitUrl: `https://github.com/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/commit/${commit.sha}`, target: path, revision: draft.revision, updatedAt: now, githubPath: path, githubSha: articleBlobSha };
}

async function deletePublishedArticle(env: Env, input: any, user: string) {
  if (input.confirmed !== true) throw new Error('Explicit deletion confirmation is required');
  const path = repoPath(String(input.path || ''));
  const expectedSha = String(input.expectedSha || '');
  if (!/^[a-f0-9]{40}$/.test(expectedSha)) throw new Error('A valid current GitHub article SHA is required');
  const draftId = input.draftId ? String(input.draftId) : '';
  if (draftId && !idPattern.test(draftId)) throw new Error('Invalid draft id');

  const db = requireDb(env);
  let linkedDraft: any = null;
  if (draftId) {
    linkedDraft = await db.prepare('SELECT id, section, slug, status, github_path, data_json FROM drafts WHERE id = ?').bind(draftId).first();
    if (linkedDraft) {
      const data = JSON.parse(linkedDraft.data_json || '{}');
      const allowedPaths = linkedDraft.github_path ? [linkedDraft.github_path] : [
        `src/content/${linkedDraft.section}/${linkedDraft.slug}.md`,
        `src/content/${linkedDraft.section}/${linkedDraft.slug}.mdx`
      ];
      if (!allowedPaths.includes(path)) throw Object.assign(new Error('The article path does not match this Studio record.'), { status: 409 });
      if (!data || data.section !== linkedDraft.section || data.slug !== linkedDraft.slug) throw new Error('Studio article metadata is inconsistent');
    }
  }

  const base = env.GITHUB_BASE_BRANCH;
  const ref = await (await githubRequest(env, `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/git/ref/heads/${encodeURIComponent(base)}`)).json() as any;
  const baseSha = String(ref.object?.sha || '');
  if (!/^[a-f0-9]{40}$/.test(baseSha)) throw new Error('Could not resolve GitHub base branch SHA');
  let current: Awaited<ReturnType<typeof githubRead>>;
  try {
    current = await githubRead(env, path, baseSha);
  } catch (error) {
    if (!(error instanceof Error && /GitHub API returned 404/.test(error.message))) throw error;
    if (linkedDraft) {
      await db.batch([
        db.prepare('DELETE FROM publish_jobs WHERE draft_id = ?').bind(draftId),
        db.prepare('DELETE FROM drafts WHERE id = ?').bind(draftId)
      ]);
    }
    return { deleted: true, alreadyAbsent: true, path, draftRemoved: Boolean(linkedDraft) };
  }
  if (current.sha !== expectedSha) throw Object.assign(new Error('GitHub article changed since it was loaded. Refresh the article list and retry deletion.'), { status: 409, conflict: true });

  const treeResponse = await githubRequest(env, `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseSha, tree: [{ path, mode: '100644', type: 'blob', sha: null }] })
  });
  const tree = await treeResponse.json() as { sha: string };
  if (!/^[a-f0-9]{40}$/.test(tree.sha || '')) throw new Error('GitHub did not return a valid deletion tree SHA');
  const commitResponse = await githubRequest(env, `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message: `Studio: Delete ${path}`, tree: tree.sha, parents: [baseSha] })
  });
  const commit = await commitResponse.json() as { sha: string };
  if (!/^[a-f0-9]{40}$/.test(commit.sha || '')) throw new Error('GitHub did not return a valid deletion commit SHA');
  try {
    await githubRequest(env, `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/git/refs/heads/${encodeURIComponent(base)}`, {
      method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false })
    });
  } catch (error) {
    if (error instanceof Error && /GitHub API returned (409|422)/.test(error.message)) throw Object.assign(new Error('The blog branch changed during deletion. Nothing was overwritten; refresh the article list and retry.'), { status: 409, conflict: true });
    throw error;
  }
  if (linkedDraft) {
    await db.batch([
      db.prepare('DELETE FROM publish_jobs WHERE draft_id = ?').bind(draftId),
      db.prepare('DELETE FROM drafts WHERE id = ?').bind(draftId)
    ]);
  }
  return { deleted: true, alreadyAbsent: false, path, draftRemoved: Boolean(linkedDraft), branch: base, commit: commit.sha, commitUrl: `https://github.com/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/commit/${commit.sha}`, deletedBy: user };
}

const validIsoDate = (value: unknown): string | null => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : null;
async function articleHash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function referencedMediaKeys(data: Record<string, any>) {
  const keys = new Set<string>();
  const source = `${String(data.markdown || '')}\n${String(data.frontmatter?.cover || '')}`;
  for (const match of source.matchAll(/(?:key=|\/media\/|\/images\/)(private\/)?([a-f0-9-]{36})\.webp/gu)) keys.add(`private/${match[2]}.webp`);
  return [...keys];
}
function publicMediaUrl(source: string) {
  return source
    .replace(/\/api\/media\/object\?key=(private\/[a-f0-9-]{36}\.webp)/gu, '/media/$1')
    .replace(/\/images\/([a-f0-9-]{36}\.webp)/gu, '/media/private/$1');
}
function articleFrontmatter(data: Record<string, any>) {
  const result = { ...(data.frontmatter && typeof data.frontmatter === 'object' ? data.frontmatter : {}) };
  if (typeof result.cover === 'string') result.cover = publicMediaUrl(result.cover);
  result.title = data.title;
  result.description = data.description;
  result.pubDate = validIsoDate(data.pubDate) || new Date().toISOString().slice(0, 10);
  if (data.updatedDate) result.updatedDate = validIsoDate(data.updatedDate);
  result.tags = data.tags;
  result.featured = Boolean(data.featured);
  delete result.draft;
  return result;
}
function articleSnapshot(db: D1Database, id: string, revision: number, data: Record<string, any>, body: string, frontmatter: Record<string, unknown>, hash: string, now: string, user: string, guardRevision?: number) {
  const fields = 'article_id, revision, title, description, pub_date, content_updated_date, body_markdown, body_html, tags_json, frontmatter_json, content_sha256, created_at, created_by';
  const values = '?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?';
  if (guardRevision === undefined) {
    return db.prepare(`INSERT INTO article_versions (${fields}) VALUES (${values})`)
      .bind(id, revision, data.title.trim(), data.description.trim(), validIsoDate(data.pubDate) || new Date().toISOString().slice(0, 10), data.updatedDate ? validIsoDate(data.updatedDate) : null, body, JSON.stringify(data.tags), JSON.stringify(frontmatter), hash, now, user);
  }
  return db.prepare(`INSERT INTO article_versions (${fields}) SELECT ${values} WHERE EXISTS (SELECT 1 FROM articles WHERE id = ? AND revision = ?) AND NOT EXISTS (SELECT 1 FROM article_versions WHERE article_id = ? AND revision = ?)`)
    .bind(id, revision, data.title.trim(), data.description.trim(), validIsoDate(data.pubDate) || new Date().toISOString().slice(0, 10), data.updatedDate ? validIsoDate(data.updatedDate) : null, body, JSON.stringify(data.tags), JSON.stringify(frontmatter), hash, now, user, id, guardRevision, id, revision);
}
function mediaRelations(db: D1Database, id: string, revision: number, data: Record<string, any>, keys: string[], now: string) {
  const coverValue = String(data.frontmatter?.cover || '');
  const coverKeyMatch = coverValue.match(/(?:key=|\/media\/|\/images\/)(?:private\/)?([a-f0-9-]{36})\.webp/u);
  return keys.map((key, position) => db.prepare("INSERT INTO article_media (article_id, media_key, role, revision, position, alt, caption, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM articles WHERE id = ? AND revision = ? AND published_revision = ? AND status = 'published') ON CONFLICT DO NOTHING")
    .bind(id, key, coverKeyMatch?.[1] && key.includes(coverKeyMatch[1]) ? 'cover' : 'body', revision, position, key === keys[0] && coverKeyMatch ? String(data.frontmatter?.coverAlt || '') : '', '', now, id, revision, revision));
}

async function v7ArticleApi(request: Request, env: Env, user: string, url: URL): Promise<Response | undefined> {
  const db = requireDb(env);
  const path = url.pathname;
  if (path === '/api/v7/articles' && request.method === 'GET') {
    const { results } = await db.prepare('SELECT id, revision, status, title, section, slug, updated_at, published_at FROM articles ORDER BY updated_at DESC LIMIT 500').all();
    return json(results);
  }
  if (path === '/api/v7/articles' && request.method === 'POST') {
    const input = await readJson(request); checkArticle(input);
    const pubDate = validIsoDate(input.pubDate);
    if (!pubDate) return json({ error: 'A valid publication date is required.' }, 400);
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    const data = { ...input, frontmatter: articleFrontmatter(input) };
    const body = publicMediaUrl(input.markdown);
    const hash = await articleHash(JSON.stringify({ ...data, body }));
    try {
      await db.batch([
        db.prepare("INSERT INTO articles (id, section, slug, title, description, pub_date, content_updated_date, body_markdown, body_html, tags_json, frontmatter_json, status, revision, published_revision, content_sha256, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'draft', 1, NULL, ?, ?, ?)")
          .bind(id, input.section, input.slug, input.title.trim(), input.description.trim(), pubDate, validIsoDate(input.updatedDate), body, JSON.stringify(input.tags), JSON.stringify(data.frontmatter), hash, now, now),
        articleSnapshot(db, id, 1, input, body, data.frontmatter, hash, now, user),
      ]);
    } catch (error) { if (/UNIQUE|constraint/i.test(String(error))) return json({ error: 'That section and slug already exist.' }, 409); throw error; }
    return json({ id, revision: 1, status: 'draft', updatedAt: now }, 201);
  }
  const match = path.match(/^\/api\/v7\/articles\/([a-zA-Z0-9_-]{8,80})(?:\/(publish|withdraw|restore|versions(?:\/(\d+)(?:\/restore)?)?))?$/u);
  if (!match) return undefined;
  const [, id, action, versionNumber] = match;
  if (request.method === 'GET' && !action) {
    const row: any = await db.prepare('SELECT * FROM articles WHERE id = ?').bind(id).first();
    return row ? json({ ...row, tags: JSON.parse(row.tags_json), frontmatter: JSON.parse(row.frontmatter_json) }) : json({ error: 'Article not found' }, 404);
  }
  if (request.method === 'GET' && action === 'versions') {
    const { results } = await db.prepare('SELECT revision, created_at, created_by FROM article_versions WHERE article_id = ? ORDER BY revision DESC LIMIT 200').bind(id).all();
    return json(results);
  }
  if (request.method === 'GET' && versionNumber && action === `versions/${versionNumber}`) {
    const article: any = await db.prepare('SELECT section, slug FROM articles WHERE id = ?').bind(id).first();
    const version: any = await db.prepare('SELECT * FROM article_versions WHERE article_id = ? AND revision = ?').bind(id, Number(versionNumber)).first();
    return version && article ? json({ ...version, data: { title: version.title, section: article.section, slug: article.slug, description: version.description, tags: JSON.parse(version.tags_json), pubDate: version.pub_date, updatedDate: version.content_updated_date || '', featured: Boolean(JSON.parse(version.frontmatter_json).featured), markdown: version.body_markdown, extension: '.md', frontmatter: JSON.parse(version.frontmatter_json) } }) : json({ error: 'Article version not found' }, 404);
  }
  const row: any = await db.prepare('SELECT * FROM articles WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'Article not found' }, 404);
  const expectedRevision = Number(request.headers.get('If-Match')?.replaceAll('"', '') || '0');
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) return json({ error: 'A valid If-Match revision is required.' }, 428);

  if (request.method === 'PUT' && !action) {
    const input = await readJson(request); checkArticle(input);
    if (input.section !== row.section || input.slug !== row.slug) return json({ error: 'Section and slug are stable after an article is created.' }, 409);
    if (row.revision !== expectedRevision) return json({ error: 'This article changed on another device.', conflict: true }, 409);
    if (row.status === 'deleted') return json({ error: 'Restore this article before editing it.' }, 409);
    const revision = row.revision + 1; const now = new Date().toISOString();
    const data = { ...input, frontmatter: articleFrontmatter(input) }; const body = publicMediaUrl(input.markdown);
    const hash = await articleHash(JSON.stringify({ ...data, body }));
    await db.batch([
      db.prepare('UPDATE articles SET title = ?, description = ?, pub_date = ?, content_updated_date = ?, body_markdown = ?, tags_json = ?, frontmatter_json = ?, revision = ?, content_sha256 = ?, updated_at = ? WHERE id = ? AND revision = ? AND deleted_at IS NULL')
        .bind(input.title.trim(), input.description.trim(), validIsoDate(input.pubDate), validIsoDate(input.updatedDate), body, JSON.stringify(input.tags), JSON.stringify(data.frontmatter), revision, hash, now, id, expectedRevision),
      articleSnapshot(db, id, revision, input, body, data.frontmatter, hash, now, user, revision),
    ]);
    const current: any = await db.prepare('SELECT revision, content_sha256 FROM articles WHERE id = ?').bind(id).first();
    if (current?.revision !== revision || current?.content_sha256 !== hash) return json({ error: 'This article changed on another device.', conflict: true }, 409);
    return json({ id, revision, status: row.status, updatedAt: now });
  }
  if (request.method === 'POST' && action === 'publish') {
    const input = await readJson(request, 20_000);
    if (input.confirmed !== true) return json({ error: 'Explicit publish confirmation is required.' }, 400);
    if (row.revision !== expectedRevision) {
      const publishedFrom: any = row.revision === expectedRevision + 1 && row.status === 'published' && row.published_revision === row.revision
        ? await db.prepare('SELECT content_sha256 FROM article_versions WHERE article_id = ? AND revision = ?').bind(id, expectedRevision).first()
        : null;
      if (publishedFrom?.content_sha256 && input.contentHash === publishedFrom.content_sha256) return json({ id, revision: row.revision, status: 'published', alreadyPublished: true });
      return json({ error: 'This article changed on another device.', conflict: true }, 409);
    }
    if (row.status === 'deleted') return json({ error: 'Restore this article before publishing it.' }, 409);
    const keys = referencedMediaKeys({ markdown: row.body_markdown, frontmatter: JSON.parse(row.frontmatter_json) });
    for (const key of keys) {
      if (!await requireR2(env).get(key)) return json({ error: `Referenced image is missing: ${key}` }, 409);
      if (!await db.prepare('SELECT key FROM media WHERE key = ?').bind(key).first()) return json({ error: `Referenced image is not registered in Studio: ${key}` }, 409);
    }
    const revision = row.revision + 1; const now = new Date().toISOString();
    const data = { title: row.title, description: row.description, section: row.section, slug: row.slug, pubDate: row.pub_date, updatedDate: row.content_updated_date, tags: JSON.parse(row.tags_json), frontmatter: JSON.parse(row.frontmatter_json) };
    const body = publicMediaUrl(row.body_markdown); const frontmatter = articleFrontmatter(data);
    const hash = await articleHash(JSON.stringify({ ...data, body }));
    await db.batch([
      db.prepare("UPDATE articles SET title = ?, description = ?, pub_date = ?, content_updated_date = ?, body_markdown = ?, tags_json = ?, frontmatter_json = ?, status = 'published', revision = ?, published_revision = ?, published_at = ?, deleted_at = NULL, content_sha256 = ?, updated_at = ? WHERE id = ? AND revision = ? AND status != 'deleted'")
        .bind(data.title, data.description, data.pubDate, data.updatedDate, body, JSON.stringify(data.tags), JSON.stringify(frontmatter), revision, revision, now, hash, now, id, expectedRevision),
      articleSnapshot(db, id, revision, data, body, frontmatter, hash, now, user, revision),
      ...mediaRelations(db, id, revision, data, keys, now),
      ...keys.map((key) => db.prepare("UPDATE media SET visibility = 'published', published_at = COALESCE(published_at, ?) WHERE key = ? AND EXISTS (SELECT 1 FROM articles WHERE id = ? AND revision = ? AND published_revision = ? AND status = 'published')").bind(now, key, id, revision, revision)),
    ]);
    const current: any = await db.prepare('SELECT revision, published_revision, status, content_sha256 FROM articles WHERE id = ?').bind(id).first();
    if (current?.revision !== revision || current?.published_revision !== revision || current?.status !== 'published' || current?.content_sha256 !== hash) return json({ error: 'This article changed on another device.', conflict: true }, 409);
    return json({ id, revision, status: 'published', publishedAt: now });
  }
  if (request.method === 'POST' && action === 'withdraw') {
    if (row.revision !== expectedRevision) return json({ error: 'This article changed on another device.', conflict: true }, 409);
    if (row.status !== 'published') return json({ error: 'Only a published article can be withdrawn.' }, 409);
    const now = new Date().toISOString();
    await db.prepare("UPDATE articles SET status = 'withdrawn', updated_at = ? WHERE id = ? AND revision = ? AND status = 'published'").bind(now, id, expectedRevision).run();
    const current: any = await db.prepare('SELECT status, revision FROM articles WHERE id = ?').bind(id).first();
    if (current?.status !== 'withdrawn' || current?.revision !== expectedRevision) return json({ error: 'This article changed on another device.', conflict: true }, 409);
    return json({ id, revision: row.revision, status: 'withdrawn', updatedAt: now });
  }
  if (request.method === 'POST' && action === 'restore') {
    if (row.revision !== expectedRevision) return json({ error: 'This article changed on another device.', conflict: true }, 409);
    if (row.status !== 'deleted' && row.status !== 'withdrawn') return json({ error: 'Only withdrawn or deleted articles can be restored.' }, 409);
    const now = new Date().toISOString();
    await db.prepare("UPDATE articles SET status = 'draft', deleted_at = NULL, published_revision = NULL, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?").bind(now, id, expectedRevision).run();
    const current: any = await db.prepare('SELECT status, revision FROM articles WHERE id = ?').bind(id).first();
    if (current?.status !== 'draft' || current?.revision !== expectedRevision + 1) return json({ error: 'This article changed on another device.', conflict: true }, 409);
    return json({ id, revision: row.revision + 1, status: 'draft', updatedAt: now });
  }
  if (request.method === 'POST' && versionNumber && action === `versions/${versionNumber}/restore`) {
    if (row.revision !== expectedRevision) return json({ error: 'This article changed on another device.', conflict: true }, 409);
    const version: any = await db.prepare('SELECT * FROM article_versions WHERE article_id = ? AND revision = ?').bind(id, Number(versionNumber)).first();
    if (!version) return json({ error: 'Article version not found.' }, 404);
    const revision = row.revision + 1; const now = new Date().toISOString();
    await db.batch([
      db.prepare('UPDATE articles SET title = ?, description = ?, pub_date = ?, content_updated_date = ?, body_markdown = ?, tags_json = ?, frontmatter_json = ?, revision = ?, content_sha256 = ?, updated_at = ? WHERE id = ? AND revision = ?')
        .bind(version.title, version.description, version.pub_date, version.content_updated_date, version.body_markdown, version.tags_json, version.frontmatter_json, revision, version.content_sha256, now, id, expectedRevision),
      db.prepare('INSERT INTO article_versions (article_id, revision, title, description, pub_date, content_updated_date, body_markdown, body_html, tags_json, frontmatter_json, content_sha256, created_at, created_by) SELECT article_id, ?, title, description, pub_date, content_updated_date, body_markdown, body_html, tags_json, frontmatter_json, content_sha256, ?, ? FROM article_versions WHERE article_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM articles WHERE id = ? AND revision = ?)')
        .bind(revision, now, user, id, Number(versionNumber), id, revision),
    ]);
    const current: any = await db.prepare('SELECT revision FROM articles WHERE id = ?').bind(id).first();
    if (current?.revision !== revision) return json({ error: 'This article changed on another device.', conflict: true }, 409);
    return json({ id, revision, restoredFrom: Number(versionNumber), status: row.status, updatedAt: now });
  }
  if (request.method === 'DELETE' && !action) {
    if (row.revision !== expectedRevision) return json({ error: 'This article changed on another device.', conflict: true }, 409);
    if (row.status === 'deleted') return json({ id, revision: row.revision, status: 'deleted', alreadyDeleted: true });
    const now = new Date().toISOString();
    await db.prepare("UPDATE articles SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ? AND revision = ? AND status != 'deleted'").bind(now, now, id, expectedRevision).run();
    const current: any = await db.prepare('SELECT status, revision FROM articles WHERE id = ?').bind(id).first();
    if (current?.status !== 'deleted' || current?.revision !== expectedRevision) return json({ error: 'This article changed on another device.', conflict: true }, 409);
    return json({ id, revision: row.revision, status: 'deleted', deletedAt: now });
  }
  return json({ error: 'Method not allowed' }, 405);
}

async function api(request: Request, env: Env, user: string): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path.startsWith('/api/v7/articles')) {
    const response = await v7ArticleApi(request, env, user, url);
    if (response) return response;
  }
  if (path === '/api/session' && request.method === 'GET') {
    const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
    const secure = env.ENVIRONMENT !== 'development' ? '; Secure' : '';
    return json({ email: user, csrf: token, contentBackend: env.CONTENT_BACKEND === 'd1' ? 'd1' : 'github' }, 200, { 'Set-Cookie': `studio_csrf=${token}; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=3600` });
  }
  if (path === '/api/drafts' && request.method === 'GET') {
    const { results } = await requireDb(env).prepare('SELECT id, revision, status, title, section, slug, updated_at, github_path, github_sha FROM drafts ORDER BY updated_at DESC').all();
    return json(results);
  }
  if (path === '/api/drafts' && request.method === 'POST') {
    const input = await readJson(request); checkArticle(input);
    const db = requireDb(env); const id = crypto.randomUUID(); const now = new Date().toISOString();
    const data: Record<string, any> = { ...input, mdx: Boolean(input.mdx) }; delete data.doc;
    await db.batch([
      db.prepare('INSERT INTO drafts (id, revision, status, title, section, slug, data_json, doc_json, github_path, github_sha, updated_at, updated_by) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, input.published ? 'published' : 'draft', input.title, input.section, input.slug, JSON.stringify(data), JSON.stringify(input.doc || {}), input.githubPath || null, input.githubSha || null, now, user),
      db.prepare('INSERT INTO draft_versions (draft_id, revision, data_json, doc_json, created_at, created_by) VALUES (?, 1, ?, ?, ?, ?)').bind(id, JSON.stringify(data), JSON.stringify(input.doc || {}), now, user)
    ]);
    return json({ id, revision: 1, updatedAt: now }, 201);
  }
  const draftMatch = path.match(/^\/api\/drafts\/([a-zA-Z0-9_-]{8,80})$/);
  if (draftMatch && request.method === 'GET') {
    const row: any = await requireDb(env).prepare('SELECT id, revision, status, data_json, doc_json, github_path, github_sha, updated_at FROM drafts WHERE id = ?').bind(draftMatch[1]).first();
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
      db.prepare('INSERT INTO draft_versions (draft_id, revision, data_json, doc_json, created_at, created_by) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1')
        .bind(draftMatch[1], next, JSON.stringify(data), JSON.stringify(input.doc || {}), now, user)
    ]) as D1Result[];
    if (result.meta.changes !== 1) return json({ error: 'This draft changed on another device. Reload or restore a version before saving.', conflict: true }, 409);
    return json({ id: draftMatch[1], revision: next, updatedAt: now });
  }
  if (draftMatch && request.method === 'DELETE') {
    const db = requireDb(env);
    await db.batch([
      db.prepare('DELETE FROM publish_jobs WHERE draft_id = ?').bind(draftMatch[1]),
      db.prepare('DELETE FROM drafts WHERE id = ?').bind(draftMatch[1])
    ]);
    return json({ deleted: true });
  }
  const versionsMatch = path.match(/^\/api\/drafts\/([a-zA-Z0-9_-]{8,80})\/versions$/);
  if (versionsMatch && request.method === 'GET') {
    const { results } = await requireDb(env).prepare('SELECT revision, created_at, created_by FROM draft_versions WHERE draft_id = ? ORDER BY revision DESC LIMIT 200').bind(versionsMatch[1]).all(); return json(results);
  }
  const versionMatch = path.match(/^\/api\/drafts\/([a-zA-Z0-9_-]{8,80})\/versions\/(\d+)$/);
  if (versionMatch && request.method === 'GET') {
    const row: any = await requireDb(env).prepare('SELECT revision, data_json, doc_json, created_at, created_by FROM draft_versions WHERE draft_id = ? AND revision = ?').bind(versionMatch[1], Number(versionMatch[2])).first();
    return row ? json({ ...row, data: JSON.parse(row.data_json), doc: JSON.parse(row.doc_json || '{}') }) : json({ error: 'Version not found' }, 404);
  }
  if (path === '/api/github/posts' && request.method === 'GET') return json(await githubPosts(env));
  const ghPost = path.match(/^\/api\/github\/post$/);
  if (ghPost && request.method === 'DELETE') {
    const input = await readJson(request, 20_000);
    return json(await deletePublishedArticle(env, input, user));
  }
  if (ghPost && request.method === 'GET') {
    const target = url.searchParams.get('path') || ''; return json(await githubRead(env, target));
  }
  if (path === '/api/media' || path === '/api/media/object') return privateMedia(request, env, url);
  if (path === '/api/publish/prepare' && request.method === 'GET') {
    const id = String(url.searchParams.get('draftId') || ''); if (!idPattern.test(id)) return json({ error: 'Invalid draft id' }, 400);
    return json(await preparePublish(env, id));
  }
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
        return json({ error: error instanceof Error ? error.message : 'Request failed', ...((error as any)?.conflict ? { conflict: true } : {}) }, status);
      }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Method not allowed' }, 405);
    const headers = new Headers(request.headers); headers.set('Cache-Control', 'private, no-store');
    const response = await env.ASSETS.fetch(new Request(request, { headers }));
    const resultHeaders = new Headers(response.headers); resultHeaders.set('Cache-Control', 'private, no-store'); resultHeaders.set('X-Content-Type-Options', 'nosniff'); resultHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin'); resultHeaders.set('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    return new Response(response.body, { status: response.status, headers: resultHeaders });
  }
};
