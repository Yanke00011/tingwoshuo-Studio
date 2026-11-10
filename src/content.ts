import { stringify as stringifyYaml } from 'yaml';

export function safeArticleSlug(value: unknown): string {
  const slug = String(value || '');
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,90}$/u.test(slug) || slug.includes('..')) throw new Error('Invalid article slug');
  return slug;
}

export function checkArticle(value: any): asserts value is Record<string, any> {
  if (!value || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 240) throw new Error('Title is required and must be under 240 characters');
  if (!['life', 'tech'].includes(value.section)) throw new Error('Invalid article section');
  safeArticleSlug(value.slug);
  if (typeof value.markdown !== 'string' || value.markdown.length > 1_500_000) throw new Error('Article body is missing or too large');
  if (typeof value.description !== 'string' || value.description.length > 1000) throw new Error('Invalid description');
  if (!Array.isArray(value.tags) || value.tags.length > 30 || value.tags.some((x: unknown) => typeof x !== 'string' || x.length > 50)) throw new Error('Invalid tags');
}

export function createMarkdown(draft: Record<string, any>): { text: string; mediaKeys: string[] } {
  const frontmatter = { ...(draft.frontmatter && typeof draft.frontmatter === 'object' ? draft.frontmatter : {}) };
  Object.assign(frontmatter, {
    title: draft.title,
    description: draft.description,
    pubDate: /^\d{4}-\d{2}-\d{2}$/.test(draft.pubDate || '') ? draft.pubDate : new Date().toISOString().slice(0, 10),
    tags: draft.tags,
    draft: false,
    featured: Boolean(draft.featured)
  });
  if (draft.updatedDate) frontmatter.updatedDate = draft.updatedDate;
  else delete frontmatter.updatedDate;
  let body = String(draft.markdown || '').trim();
  const mediaKeys = new Set<string>();
  body = body.replace(/!\[([^\]]*)\]\(\/api\/media\/object\?key=(private\/[a-f0-9-]{36}\.webp)\)/g, (_whole, alt: string, key: string) => {
    mediaKeys.add(key);
    return `![${alt}](/images/${key.slice('private/'.length)})`;
  });
  return { text: `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n\n${body}\n`, mediaKeys: [...mediaKeys] };
}
