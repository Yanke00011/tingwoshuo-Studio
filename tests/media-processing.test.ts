import { describe, expect, it } from 'vitest';
import { centeredCrop, coverCrop, fitImage, imageFormat } from '../src/ui/media-processing';
import { assertMediaAlt } from '../src/ui/editor-image';
import { mediaUrl } from '../src/ui/media-transport';
import { createMarkdown } from '../src/content';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('image preflight', () => {
  it('leaves a small image at its original size', () => {
    expect(fitImage({ width: 500, height: 300 }, 2560)).toEqual({ width: 500, height: 300 });
  });

  it('reduces wide and vertical images while retaining their proportions', () => {
    expect(fitImage({ width: 6000, height: 300 }, 2560)).toEqual({ width: 2560, height: 128 });
    expect(fitImage({ width: 800, height: 6400 }, 2560)).toEqual({ width: 320, height: 2560 });
  });

  it('crops a portrait at center and allows movement without leaving the source bounds', () => {
    const portrait = { width: 1600, height: 2000 };
    expect(coverCrop(portrait, centeredCrop)).toEqual({ width: 1600, height: 900, x: 0, y: 550 });
    expect(coverCrop(portrait, { x: 1, y: 1, zoom: 2 })).toEqual({ width: 800, height: 450, x: 800, y: 1550 });
  });

  it('rejects known animations and unrecognized formats before decoding', () => {
    expect(() => imageFormat(bytes('GIF89a'))).toThrow('GIF');
    expect(() => imageFormat(bytes('RIFF0000WEBPANIM0000'))).toThrow('动画 WebP');
    expect(() => imageFormat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 97, 99, 84, 76, 0, 0, 0, 0]))).toThrow('动画 PNG');
    expect(() => imageFormat(bytes('<svg/>'))).toThrow('HEIC 和 SVG');
    expect(imageFormat(bytes('RIFF0000WEBPVP8 0000'))).toBe('webp');
  });
});

it('uses private image references compatible with the frozen publisher and retains captions', () => {
  const key = 'private/12345678-1234-1234-1234-123456789abc.webp';
  const alt = '截图说明';
  assertMediaAlt(alt);
  expect(() => assertMediaAlt('截图 [1]')).toThrow('方括号');
  const markdown = `![${alt}](${mediaUrl(key)})\n\n*旧版图注*`;
  const result = createMarkdown({ title: '图文', section: 'life', slug: 'media', markdown, tags: [], frontmatter: { cover: '/images/already-public.webp' } });
  expect(result.mediaKeys).toEqual([key]);
  expect(result.text).toContain('![截图说明](/images/12345678-1234-1234-1234-123456789abc.webp)\n\n*旧版图注*');
  expect(result.text).toContain('cover: /images/already-public.webp');
});
