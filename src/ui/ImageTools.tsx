import { useEffect, useRef, useState } from 'react';
import type { SelectedImage } from './editor-image';

export function ImageTools({ image, save, replace, remove }: {
  image: SelectedImage;
  save: (alt: string, caption: string) => void;
  replace: () => void;
  remove: () => void;
}) {
  const [alt, setAlt] = useState(image.alt);
  const [caption, setCaption] = useState(image.caption);
  const [width, setWidth] = useState('100');
  const [alignment, setAlignment] = useState('center');
  const preview = useRef<HTMLDialogElement>(null);
  useEffect(() => { setAlt(image.alt); setCaption(image.caption); }, [image.alt, image.caption]);
  return <section className="image-tools" aria-label="选中图片工具">
    <div className="image-tools-head"><strong>选中的正文图片</strong>
      <button type="button" className="media-button" onClick={() => preview.current?.showModal()}>放大预览</button>
      <button type="button" className="media-button" onClick={replace}>替换</button>
      <button type="button" className="media-button" onClick={remove}>移除图片</button>
    </div>
    <div className="media-fields">
      <label>图片 Alt<input value={alt} maxLength={300} onChange={(event) => setAlt(event.target.value)} /></label>
      <label>图片图注<input value={caption} maxLength={500} onChange={(event) => setCaption(event.target.value)} /></label>
      <button type="button" className="media-button primary" onClick={() => save(alt.trim(), caption.trim())}>应用描述</button>
    </div>
    {image.caption && <small>当前图注来自图片后相邻的斜体段落。</small>}
    <dialog className="media-dialog image-preview" ref={preview} aria-label="图片预览">
      <button type="button" className="media-button" onClick={() => preview.current?.close()}>关闭预览</button>
      <div className="media-fields">
        <label>预览宽度<select value={width} onChange={(event) => setWidth(event.target.value)}><option value="100">100%</option><option value="75">75%</option><option value="50">50%</option></select></label>
        <label>预览对齐<select value={alignment} onChange={(event) => setAlignment(event.target.value)}><option value="left">左侧</option><option value="center">居中</option><option value="right">右侧</option></select></label>
      </div>
      <p className="media-status">布局仅用于此处预览，发布后的正文图片随阅读区宽度自适应。</p>
      <div className={`image-preview-stage ${alignment}`}>
        <img src={image.src} alt={image.alt} style={{ maxWidth: `${width}%` }} />
      </div>
      {image.caption && <p>{image.caption}</p>}
    </dialog>
  </section>;
}
