import { describe, expect, it } from 'vitest';
import { checkArticle, createMarkdown, safeArticleSlug } from '../src/content';
import { repoPath } from '../src/github';

const sample = { title:'A note', section:'life', slug:'note-1', markdown:'Keep <Callout tone="warm">this exact source</Callout>.\n\n![A private image](/api/media/object?key=private/123e4567-e89b-12d3-a456-426614174000.webp)', description:'A short note', tags:['life'], pubDate:'2026-11-10', updatedDate:'', featured:false, frontmatter:{customField:{kept:true},author:'小张'} };

describe('content safety and export', () => {
  it('keeps unknown frontmatter values and raw MDX body while mapping private media to public Git files', () => {
    const generated = createMarkdown(sample);
    expect(generated.text).toContain('customField:');
    expect(generated.text).toContain('kept: true');
    expect(generated.text).toContain('<Callout tone="warm">this exact source</Callout>');
    expect(generated.text).toContain('![A private image](/images/123e4567-e89b-12d3-a456-426614174000.webp)');
    expect(generated.mediaKeys).toEqual(['private/123e4567-e89b-12d3-a456-426614174000.webp']);
  });
  it('validates title, section, slug, and bounded article metadata', () => {
    expect(() => safeArticleSlug('../outside')).toThrow();
    expect(() => checkArticle({ ...sample, section:'admin' })).toThrow('Invalid article section');
    expect(() => checkArticle({ ...sample, title:'' })).toThrow('Title is required');
    expect(() => checkArticle({ ...sample, tags:Array.from({length:31},(_,i)=>String(i)) })).toThrow('Invalid tags');
  });
  it('allows only articles under approved repository folders', () => {
    expect(repoPath('src/content/life/今天的生活.md')).toBe('src/content/life/今天的生活.md');
    expect(() => repoPath('public/evil.md')).toThrow();
    expect(() => repoPath('src/content/life/../secret.md')).toThrow();
  });
});
