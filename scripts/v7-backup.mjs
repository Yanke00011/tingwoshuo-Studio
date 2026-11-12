import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { parseDocument } from 'yaml';

const studioRoot = path.resolve(import.meta.dirname, '..');
const blogRoot = path.resolve(studioRoot, '../tingwoshuo.github.io');
const args = parseArgs(process.argv.slice(2));

function parseArgs(values) {
  const result = {};
  if (values[0] === '--') values = values.slice(1);
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === '--source-only') result.sourceOnly = true;
    else if (value.startsWith('--')) result[value.slice(2)] = values[++i];
    else throw new Error(`Unexpected argument: ${value}`);
  }
  return result;
}

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function within(parent, target) { return target === parent || target.startsWith(parent + path.sep); }
function markdownReferences(markdown) {
  const refs = new Set();
  for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) refs.add(match[1]);
  for (const match of markdown.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) refs.add(match[1]);
  return [...refs];
}
async function walk(directory, files = []) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, item.name);
    if (item.isDirectory()) await walk(target, files);
    else if (item.isFile()) files.push(target);
  }
  return files.sort();
}
async function walkArticles(directory) {
  return (await walk(directory)).filter((file) => /\.(md|mdx)$/i.test(file));
}
async function encryptTar(sourceDirectory, destination, recipient) {
  if (!/^age1[0-9a-z]+$/u.test(recipient)) throw new Error('Expected an age public recipient beginning with age1.');
  const tar = spawn('tar', ['-czf', '-', '-C', sourceDirectory, '.'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const age = spawn('age', ['--encrypt', '--recipient', recipient, '--output', destination], { stdio: ['pipe', 'ignore', 'inherit'] });
  tar.stdout.pipe(age.stdin);
  const results = await Promise.all([tar, age].map(waitForExit));
  if (results.some((code) => code !== 0)) {
    tar.kill('SIGTERM'); age.kill('SIGTERM');
    throw new Error('Encrypted archive creation failed. Check that tar and age are installed and that the age recipient is valid.');
  }
}
function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code));
  });
}
async function verifyEncryptedTar(archive, identityFile) {
  const age = spawn('age', ['--decrypt', '--identity', identityFile, archive], { stdio: ['ignore', 'pipe', 'inherit'] });
  const tar = spawn('tar', ['-tzf', '-'], { stdio: ['pipe', 'ignore', 'inherit'] });
  age.stdout.pipe(tar.stdin);
  const results = await Promise.all([age, tar].map(waitForExit));
  if (results.some((code) => code !== 0)) {
    age.kill('SIGTERM'); tar.kill('SIGTERM');
    throw new Error('Encrypted backup verification failed; the archive was removed. Check the age identity and retry.');
  }
}
async function readArticle(file) {
  const bytes = await readFile(file);
  const source = bytes.toString('utf8');
  const match = source.match(/^---\s*\n([\s\S]*?)\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`Missing YAML frontmatter: ${path.relative(blogRoot, file)}`);
  const document = parseDocument(match[1]);
  if (document.errors.length) throw new Error(`Invalid YAML in ${path.relative(blogRoot, file)}: ${document.errors[0].message}`);
  const frontmatter = document.toJS();
  const section = path.relative(path.join(blogRoot, 'src/content'), file).split(path.sep)[0];
  if (!['life', 'tech'].includes(section)) throw new Error(`Unsupported article section: ${file}`);
  const slug = path.basename(file).replace(/\.mdx?$/i, '');
  const markdown = source.slice(match[0].length);
  return {
    sourcePath: path.relative(blogRoot, file).split(path.sep).join('/'),
    section,
    slug,
    title: String(frontmatter.title || ''),
    pubDate: frontmatter.pubDate instanceof Date ? frontmatter.pubDate.toISOString().slice(0, 10) : String(frontmatter.pubDate || '').slice(0, 10),
    draft: Boolean(frontmatter.draft),
    sourceSha256: sha256(bytes),
    sourceBytes: bytes.byteLength,
    mediaReferences: markdownReferences(markdown),
  };
}
async function gitHead(directory) {
  const { execFileSync } = await import('node:child_process');
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim(); }
  catch { return null; }
}

if (!args.output) throw new Error('Usage: pnpm v7:backup -- --output /secure/path/backup.tar.gz.age --d1-export /secure/studio-d1.sql --r2-inventory /secure/r2-inventory.json --r2-head /secure/r2-head.jsonl --r2-files /secure/r2-objects --blog-git-bundle /secure/blog-repository.bundle --age-recipient age1... | --source-only --output /secure/source-snapshot');
if (!args.sourceOnly && (!args['d1-export'] || !args['r2-inventory'] || !args['r2-head'] || !args['r2-files'] || !args['blog-git-bundle'] || !args['age-recipient'] || !args['age-identity'])) {
  throw new Error('A complete backup requires D1 export, R2 key inventory, per-object R2 head metadata, downloaded R2 object files, a Git bundle of the blog history, an age recipient, and its private identity for verification. Use --source-only only for a clearly incomplete source snapshot.');
}

const output = path.resolve(args.output);
const outputParent = await realpath(path.dirname(output)).catch(async () => {
  await mkdir(path.dirname(output), { recursive: true });
  return realpath(path.dirname(output));
});
const finalOutput = path.join(outputParent, path.basename(output));
if (within(studioRoot, finalOutput) || within(blogRoot, finalOutput)) throw new Error('Backup output must be outside both Git repositories.');
if (await stat(finalOutput).then(() => true, () => false)) throw new Error(`Backup destination already exists: ${finalOutput}`);
const r2FilesRoot = args['r2-files'] ? path.resolve(args['r2-files']) : undefined;
const r2FilesStat = r2FilesRoot ? await stat(r2FilesRoot).catch(() => null) : null;
if (!args.sourceOnly && !r2FilesStat?.isDirectory()) throw new Error('--r2-files must point to a directory containing every downloaded R2 object.');
const stage = args.sourceOnly ? finalOutput : path.join(outputParent, `.v7-backup-staging-${randomUUID()}`);
if (!args.sourceOnly) await mkdir(stage, { recursive: false, mode: 0o700 });

try {
const contentRoot = path.join(blogRoot, 'src/content');
const files = await walkArticles(contentRoot);
const articles = await Promise.all(files.map(readArticle));
const slugs = new Set();
for (const article of articles) {
  const key = `${article.section}/${article.slug}`;
  if (slugs.has(key)) throw new Error(`Duplicate article slug: ${key}`);
  slugs.add(key);
}

await mkdir(path.join(stage, 'blog-source', 'src', 'content'), { recursive: true });
for (const file of files) {
  const relative = path.relative(blogRoot, file);
  const target = path.join(stage, 'blog-source', relative);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(file, target);
}
const publicImages = path.join(blogRoot, 'public/images');
const imageFiles = await stat(publicImages).then(() => walk(publicImages), () => []);
for (const file of imageFiles) {
  const target = path.join(stage, 'blog-source', 'public/images', path.relative(publicImages, file));
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(file, target);
}

const filesManifest = [];
for (const file of [...files, ...imageFiles]) {
  const bytes = await readFile(file);
  filesManifest.push({ path: path.relative(blogRoot, file).split(path.sep).join('/'), bytes: bytes.byteLength, sha256: sha256(bytes) });
}
const dataInputs = [];
if (args['d1-export']) dataInputs.push({ source: path.resolve(args['d1-export']), target: 'd1-export.sql' });
if (args['r2-inventory']) dataInputs.push({ source: path.resolve(args['r2-inventory']), target: 'r2-inventory.json' });
if (args['r2-head']) dataInputs.push({ source: path.resolve(args['r2-head']), target: 'r2-head.jsonl' });
if (args['blog-git-bundle']) dataInputs.push({ source: path.resolve(args['blog-git-bundle']), target: 'blog-repository.bundle' });
for (const input of dataInputs) {
  const bytes = await readFile(input.source);
  await writeFile(path.join(stage, input.target), bytes, { flag: 'wx', mode: 0o600 });
  filesManifest.push({ path: input.target, bytes: bytes.byteLength, sha256: sha256(bytes), classification: 'private-backup-input' });
}
if (args['blog-git-bundle']) {
  const verify = spawn('git', ['bundle', 'verify', path.resolve(args['blog-git-bundle'])], { cwd: blogRoot, stdio: ['ignore', 'inherit', 'inherit'] });
  if (await waitForExit(verify) !== 0) throw new Error('--blog-git-bundle is not a valid bundle for the blog repository.');
}
const r2Files = r2FilesRoot ? await walk(r2FilesRoot) : [];
if (!args.sourceOnly) {
  let inventory;
  try { inventory = JSON.parse(await readFile(path.resolve(args['r2-inventory']), 'utf8')); }
  catch { throw new Error('--r2-inventory must be JSON output from `aws s3api list-objects-v2`.'); }
  const expectedKeys = (inventory.Contents ?? []).map((object) => object.Key).filter((key) => typeof key === 'string').sort();
  const actualKeys = r2Files.map((file) => path.relative(r2FilesRoot, file).split(path.sep).join('/')).sort();
  if (!Array.isArray(inventory.Contents) && expectedKeys.length) throw new Error('R2 inventory is missing the Contents array.');
  if (expectedKeys.length !== actualKeys.length || expectedKeys.some((key, index) => key !== actualKeys[index])) {
    throw new Error(`R2 object inventory mismatch: ${expectedKeys.length} listed, ${actualKeys.length} downloaded. Refusing to seal an incomplete backup.`);
  }
  const headRecords = (await readFile(path.resolve(args['r2-head']), 'utf8')).split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  const headKeys = headRecords.map((record) => record.Key).filter((key) => typeof key === 'string').sort();
  if (headKeys.length !== expectedKeys.length || expectedKeys.some((key, index) => key !== headKeys[index])) {
    throw new Error(`R2 object metadata inventory mismatch: ${expectedKeys.length} listed, ${headKeys.length} head records. Refusing to seal an incomplete backup.`);
  }
}
for (const file of r2Files) {
  const relative = path.relative(r2FilesRoot, file);
  const target = path.join(stage, 'r2-objects', relative);
  const bytes = await readFile(file);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(file, target);
  filesManifest.push({ path: `r2-objects/${relative.split(path.sep).join('/')}`, bytes: bytes.byteLength, sha256: sha256(bytes), classification: 'private-r2-object' });
}
const d1Export = args['d1-export'] ? await readFile(path.resolve(args['d1-export']), 'utf8') : '';
if (!args.sourceOnly && !d1Export.trim()) throw new Error('D1 export is empty; refusing to create an incomplete backup.');
for (const table of ['drafts', 'draft_versions', 'media', 'publish_jobs', 'rate_limits']) {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (d1Export && !new RegExp(`CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?["\x60\\[]?${escaped}["\x60\\]]?`, 'iu').test(d1Export)) throw new Error(`D1 export does not appear to contain the required ${table} table.`);
}

if (d1Export && /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["\x60\[]?articles["\x60\]]?/iu.test(d1Export)) {
  for (const table of ['articles', 'article_versions', 'article_media', 'legacy_imports', 'd1_migrations']) {
    const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?["\\x60\\[]?${escaped}["\\x60\\]]?`, 'iu').test(d1Export)) {
      throw new Error(`V7 D1 export does not appear to contain the required ${table} table.`);
    }
  }
  if (/CREATE VIRTUAL TABLE\s+(?:IF NOT EXISTS\s+)?["\x60\[]?article_search/iu.test(d1Export)) {
    throw new Error('D1 export contains the FTS5 article_search virtual table. Export base application tables only and rebuild FTS5 after restore.');
  }
}

for (const article of articles) {
  const source = await readFile(path.join(blogRoot, article.sourcePath), 'utf8');
  const match = source.match(/^---\s*\n([\s\S]*?)\n---(?:\r?\n|$)/);
  const frontmatter = parseDocument(match?.[1] ?? '').toJS();
  if (typeof frontmatter.cover === 'string') article.mediaReferences.push(frontmatter.cover);
}

const report = {
  formatVersion: 1,
  createdAt: new Date().toISOString(),
  mode: args.sourceOnly ? 'source-only' : 'complete',
  complete: !args.sourceOnly,
  encryption: args.sourceOnly ? null : { format: 'age + gzip tar', recipient: args['age-recipient'], decryptVerified: !args.sourceOnly },
  repositories: { blogHead: await gitHead(blogRoot), studioHead: await gitHead(studioRoot) },
  articleCount: articles.length,
  articles,
  mediaReferenceCount: articles.reduce((total, article) => total + article.mediaReferences.length, 0),
  r2InventoryIncluded: Boolean(args['r2-inventory']),
  r2ObjectsIncluded: r2Files.length,
  d1ExportIncluded: Boolean(args['d1-export']),
  files: filesManifest,
  limitations: args.sourceOnly ? [
    'D1 export not supplied; current private drafts and D1 media metadata are not backed up.',
    'R2 inventory not supplied; private R2 objects and object metadata are not backed up.'
  ] : [],
};
await writeFile(path.join(stage, 'backup-manifest.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
if (!args.sourceOnly) {
  let verified = false;
  try {
    await encryptTar(stage, finalOutput, args['age-recipient']);
    await verifyEncryptedTar(finalOutput, path.resolve(args['age-identity']));
    verified = true;
  } finally {
    await rm(stage, { recursive: true, force: true });
    if (!verified) await rm(finalOutput, { force: true });
  }
}
console.log(JSON.stringify({ output: finalOutput, mode: report.mode, complete: report.complete, encrypted: !args.sourceOnly, articles: report.articleCount, sourceFiles: filesManifest.length, r2ObjectsIncluded: report.r2ObjectsIncluded, d1ExportIncluded: report.d1ExportIncluded, r2InventoryIncluded: report.r2InventoryIncluded }, null, 2));
} catch (error) {
  if (!args.sourceOnly) {
    await rm(stage, { recursive: true, force: true });
    await rm(finalOutput, { force: true });
  }
  throw error;
}
