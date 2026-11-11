export const uploadLimit = 8 * 1024 * 1024;
export const coverSize = { width: 1600, height: 900 };
export type Size = { width: number; height: number };
export type Crop = { x: number; y: number; zoom: number };
export type ImageKind = 'auto' | 'photo' | 'detail';
export const centeredCrop: Crop = { x: .5, y: .5, zoom: 1 };
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function fitImage(size: Size, longest: number): Size {
  const scale = Math.min(1, longest / Math.max(size.width, size.height));
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
}

export function coverCrop(size: Size, crop: Crop) {
  const ratio = coverSize.width / coverSize.height;
  const width = Math.min(size.width, size.height * ratio) / clamp(crop.zoom, 1, 4);
  const height = width / ratio;
  return { width, height, x: (size.width - width) * clamp(crop.x, 0, 1), y: (size.height - height) * clamp(crop.y, 0, 1) };
}

function ascii(bytes: Uint8Array, from: number, to: number) {
  return new TextDecoder().decode(bytes.subarray(from, to));
}

export function imageFormat(bytes: Uint8Array): 'jpeg' | 'png' | 'webp' | 'avif' {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(bytes, 0, 3) === 'GIF') throw Error('暂不处理 GIF，以免丢失动画。请选择静态图片。');
  if (bytes[0] === 255 && bytes[1] === 216) return 'jpeg';
  if (bytes[0] === 137 && ascii(bytes, 1, 4) === 'PNG') {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      if (ascii(bytes, offset + 4, offset + 8) === 'acTL') throw Error('暂不处理动画 PNG。');
      offset += 12 + view.getUint32(offset);
    }
    return 'png';
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const type = ascii(bytes, offset, offset + 4);
      if (type === 'ANIM' || type === 'ANMF' || (type === 'VP8X' && (bytes[offset + 8] & 2))) throw Error('暂不处理动画 WebP。');
      const length = view.getUint32(offset + 4, true);
      offset += 8 + length + (length % 2);
    }
    return 'webp';
  }
  if (ascii(bytes, 4, 8) === 'ftyp' && bytes.length >= 16) {
    const brands: string[] = ascii(bytes, 8, Math.min(view.getUint32(0), bytes.length)).match(/.{4}/gs) ?? [];
    if (brands.includes('avis')) throw Error('暂不处理动画 AVIF。');
    if (brands.includes('avif')) return 'avif';
  }
  throw Error('请选择静态 JPEG、PNG、WebP 或 AVIF。HEIC 和 SVG 请先在本地转换。');
}

export async function loadImage(file: File) {
  if (file.size > 64 * 1024 * 1024) throw Error('原图超过 64 MiB，请先在本地缩小。');
  const format = imageFormat(new Uint8Array(await file.arrayBuffer()));
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try { await image.decode(); } catch { throw Error('当前浏览器无法解码这张图片，请尝试导出为 PNG 或 JPEG。'); }
    if (!image.naturalWidth || !image.naturalHeight) throw Error('无法读取图片尺寸。');
    return { image, format, size: { width: image.naturalWidth, height: image.naturalHeight } };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function drawImage(source: HTMLImageElement, canvas: HTMLCanvasElement, size: Size, crop?: ReturnType<typeof coverCrop>) {
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) throw Error('浏览器无法创建图片画布。');
  context.imageSmoothingQuality = 'high';
  if (crop) context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, size.width, size.height);
  else context.drawImage(source, 0, 0, size.width, size.height);
}

async function webp(canvas: HTMLCanvasElement, quality: number) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
  if (!blob || blob.type !== 'image/webp') throw Error('浏览器无法导出 WebP。原图仍可下载或重新选择。');
  return blob;
}

export async function optimizeImage(
  file: File, source: Awaited<ReturnType<typeof loadImage>>,
  options: { crop?: Crop; kind: ImageKind; longest: number; keepOriginal?: boolean },
) {
  const { crop, kind, longest, keepOriginal } = options;
  const original = source.format === 'webp' && file.size <= uploadLimit;
  if (keepOriginal && original && !crop) return { blob: file.slice(0, file.size, 'image/webp'), size: source.size, original: true };

  const detail = kind === 'detail' || (kind === 'auto' && source.format === 'png');
  let size = crop ? coverSize : fitImage(source.size, longest);
  const target = (crop ? 350 : detail ? 1250 : 600) * 1024;
  if (!crop && original && size.width === source.size.width && size.height === source.size.height && file.size <= target) {
    return { blob: file.slice(0, file.size, 'image/webp'), size: source.size, original: true };
  }
  const canvas = document.createElement('canvas');
  const region = crop ? coverCrop(source.size, crop) : undefined;
  drawImage(source.image, canvas, size, region);
  const qualities = detail ? [.97, .92, .87] : [.9, .84, .77, .7];
  let blob = await webp(canvas, qualities[0]);
  for (const quality of qualities.slice(1)) {
    if (blob.size <= target) break;
    const next = await webp(canvas, quality);
    if (next.size < blob.size) blob = next;
  }
  if (!crop && original && size.width === source.size.width && size.height === source.size.height && blob.size >= file.size) {
    return { blob: file.slice(0, file.size, 'image/webp'), size: source.size, original: true };
  }
  if (!crop && blob.size > uploadLimit) {
    size = fitImage(source.size, Math.min(longest, 1600));
    drawImage(source.image, canvas, size);
    blob = await webp(canvas, detail ? .92 : .82);
  }
  if (blob.size > uploadLimit) throw Error('优化后仍超过现有上传上限 8 MiB，请降低尺寸或另选图片。');
  return { blob, size, original: false };
}
