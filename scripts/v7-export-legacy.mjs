import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { parseDocument } from 'yaml';

const studioRoot = path.resolve(import.meta.dirname, '..');
const blogRoot = path.resolve(studioRoot, '../tingwoshuo.github.io');
const args = parseArgs(process.argv.slice(2));
function parseArgs(values) {
  const result = {};
  if (values[0] === '--') values = values.slice(1);
  for (let i = 0; i < values.length; i++) {
    if (values[i] === '--apply') result.apply = true;
    else if (values[i].startsWith('--')) result[values[i].slice(2)] = values[++i];
    else throw new Error(`Unexpected argument: ${values[i]}`);
  }
  return result;
}
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function sql(value) { return value === null || value === undefined ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`; }
function sqlJson(value) { return sql(JSON.stringify(value)); }
function mediaReferences(markdown) {
  const refs = new Set();
  for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) refs.add(match[1]);
  for (const match of markdown.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) refs.add(match[1]);
  return [...refs];
}
async function walk(directory, files = []) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) await walk(file, files);
    else if (item.isFile() && /\.(md|mdx)$/i.test(item.name)) files.push(file);
  }
  return files.sort();
}
function normalizeDate(value) {
  if (value instanceof Date && Number.isFinite(value.valueOf())) return value.toISOString().slice(0, 10);
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`)) ? text : null;
}
function idFor(section, slug) { return `legacy-${sha256(`tingwoshuo:v7:${section}/${slug}`).slice(0, 40)}`; }
function isWithin(parent, target) { return target === parent || target.startsWith(parent + path.sep); }
async function exists(file) { return stat(file).then(() => true, () => false); }

if (!args.output) throw new Error('Usage: pnpm v7:export-legacy -- --output /secure/path/import.sql [--input /path/to/src/content] [--apply --target migration-test]');
if (args.apply && args.target !== 'migration-test') throw new Error('--apply is restricted to --target migration-test; production and other targets are refused.');
const inputRoot = path.resolve(args.input || path.join(blogRoot, 'src/content'));
const output = path.resolve(args.output);
const outputParent = await realpath(path.dirname(output)).catch(async () => { await mkdir(path.dirname(output), { recursive: true }); return realpath(path.dirname(output)); });
const finalOutput = path.join(outputParent, path.basename(output));
if (isWithin(studioRoot, finalOutput) || isWithin(blogRoot, finalOutput)) throw new Error('Migration SQL must be written outside both Git repositories.');
if (await exists(finalOutput)) throw new Error(`Refusing to replace an existing migration file: ${finalOutput}`);

const sourceFiles = await walk(inputRoot);
if (!sourceFiles.length) throw new Error(`No Markdown or MDX articles found at ${inputRoot}`);
const articles = [];
const diagnostics = [];
const seenSlugs = new Set();
for (const file of sourceFiles) {
  const bytes = await readFile(file);
  const source = bytes.toString('utf8');
  const match = source.match(/^---\s*\n([\s\S]*?)\n---(?:\r?\n|$)/);
  const sourcePath = path.relative(blogRoot, file).split(path.sep).join('/');
  if (!match) { diagnostics.push({ severity: 'error', sourcePath, message: 'Missing frontmatter fence' }); continue; }
  const document = parseDocument(match[1]);
  if (document.errors.length) { diagnostics.push({ severity: 'error', sourcePath, message: document.errors[0].message }); continue; }
  const frontmatter = document.toJS();
  const section = path.relative(inputRoot, file).split(path.sep)[0];
  const slug = path.basename(file).replace(/\.mdx?$/i, '');
  const key = `${section}/${slug}`;
  const id = idFor(section, slug);
  const pubDate = normalizeDate(frontmatter.pubDate);
  const contentUpdatedDate = frontmatter.updatedDate ? normalizeDate(frontmatter.updatedDate) : null;
  if (!['life', 'tech'].includes(section)) diagnostics.push({ severity: 'error', sourcePath, message: `Unsupported section ${section}` });
  if (!frontmatter.title || !String(frontmatter.title).trim()) diagnostics.push({ severity: 'error', sourcePath, message: 'Missing title' });
  if (!frontmatter.description || !String(frontmatter.description).trim()) diagnostics.push({ severity: 'error', sourcePath, message: 'Missing description' });
  if (!pubDate) diagnostics.push({ severity: 'error', sourcePath, message: 'Missing or invalid pubDate' });
  if (seenSlugs.has(key)) diagnostics.push({ severity: 'error', sourcePath, message: `Duplicate slug ${key}` });
  seenSlugs.add(key);
  const body = source.slice(match[0].length);
  const hash = sha256(source);
  const references = mediaReferences(body);
  for (const ref of references) {
    if (ref.startsWith('/images/') && !ref.includes('..') && !await exists(path.join(blogRoot, 'public', ref.slice(1)))) {
      diagnostics.push({ severity: 'warning', sourcePath, message: `Local media reference not found: ${ref}` });
    }
  }
  const status = frontmatter.draft === true ? 'draft' : 'published';
  const publishedAt = status === 'published' ? `${pubDate}T00:00:00.000Z` : null;
  const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : [];
  const createdAt = publishedAt || new Date(0).toISOString();
  articles.push({ id, section, slug, title: String(frontmatter.title), description: String(frontmatter.description), pubDate, contentUpdatedDate, body, tags, frontmatter, status, publishedAt, createdAt, sourceSha256: hash, sourcePath, mediaReferences: references });
}

const errors = diagnostics.filter((item) => item.severity === 'error');
const duplicateIds = new Set(articles.map((article) => article.id)).size !== articles.length;
if (errors.length) throw new Error(`Import validation failed with ${errors.length} error(s):\n${errors.map((item) => `${item.sourcePath}: ${item.message}`).join('\n')}`);
if (duplicateIds) throw new Error('Duplicate stable IDs detected.');
const report = {
  mode: args.apply ? 'apply-isolated-test' : 'dry-run',
  inputRoot,
  discovered: sourceFiles.length,
  accepted: articles.length,
  errors: 0,
  warnings: diagnostics.filter((item) => item.severity === 'warning').length,
  duplicateIds,
  mediaReferences: articles.reduce((count, article) => count + article.mediaReferences.length, 0),
  articles: articles.map(({ id, section, slug, title, pubDate, contentUpdatedDate, status, sourcePath, sourceSha256, mediaReferences }) => ({ id, section, slug, title, pubDate, contentUpdatedDate, status, sourcePath, sourceSha256, mediaReferences })),
  diagnostics,
};

const statements = ['-- Generated by scripts/v7-export-legacy.mjs. Dry-run by default; review before local application.', 'PRAGMA foreign_keys = ON;'];
for (const article of articles) {
  statements.push(
    `INSERT INTO articles (id, section, slug, title, description, pub_date, content_updated_date, body_markdown, body_html, tags_json, frontmatter_json, status, revision, published_revision, content_sha256, created_at, updated_at, published_at, deleted_at, legacy_source_path) VALUES (${sql(article.id)}, ${sql(article.section)}, ${sql(article.slug)}, ${sql(article.title)}, ${sql(article.description)}, ${sql(article.pubDate)}, ${sql(article.contentUpdatedDate)}, ${sql(article.body)}, NULL, ${sqlJson(article.tags)}, ${sqlJson(article.frontmatter)}, ${sql(article.status)}, 1, ${article.status === 'published' ? '1' : 'NULL'}, ${sql(article.sourceSha256)}, ${sql(article.createdAt)}, ${sql(article.createdAt)}, ${sql(article.publishedAt)}, NULL, ${sql(article.sourcePath)}) ON CONFLICT(id) DO NOTHING;`,
    `INSERT INTO legacy_imports (source_path, article_id, source_sha256, imported_at) SELECT ${sql(article.sourcePath)}, ${sql(article.id)}, ${sql(article.sourceSha256)}, ${sql(new Date().toISOString())} WHERE EXISTS (SELECT 1 FROM articles WHERE id = ${sql(article.id)} AND content_sha256 = ${sql(article.sourceSha256)}) ON CONFLICT(source_path) DO NOTHING;`,
    `INSERT INTO article_versions (article_id, revision, title, description, pub_date, content_updated_date, body_markdown, body_html, tags_json, frontmatter_json, content_sha256, created_at, created_by) SELECT id, revision, title, description, pub_date, content_updated_date, body_markdown, body_html, tags_json, frontmatter_json, content_sha256, created_at, 'v7-legacy-import' FROM articles WHERE id = ${sql(article.id)} AND content_sha256 = ${sql(article.sourceSha256)} AND NOT EXISTS (SELECT 1 FROM article_versions WHERE article_id = ${sql(article.id)} AND revision = 1);`
  );
}
await writeFile(finalOutput, `${statements.join('\n')}\n`, { flag: 'wx', mode: 0o600 });
const reportPath = `${finalOutput}.report.json`;
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });

if (args.apply) {
  const config = path.join(studioRoot, 'wrangler.migration.jsonc');
  const migrate = spawnSync('pnpm', ['db:v7:test:migrate'], { cwd: studioRoot, encoding: 'utf8' });
  if (migrate.status !== 0) throw new Error(`Isolated schema migration failed:\n${migrate.stderr || migrate.stdout}`);
  const apply = spawnSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'tingwoshuo-studio-migration-test-v7', '--local', '--config', config, '--file', finalOutput], { cwd: studioRoot, encoding: 'utf8' });
  if (apply.status !== 0) throw new Error(`Isolated import failed:\n${apply.stderr || apply.stdout}`);
  console.log(JSON.stringify({ ...report, sql: finalOutput, reportPath, applied: true, output: apply.stdout }, null, 2));
} else console.log(JSON.stringify({ ...report, sql: finalOutput, reportPath, applied: false }, null, 2));
