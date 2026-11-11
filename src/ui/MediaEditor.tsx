import { useEffect, useRef, useState } from 'react';
import { centeredCrop, coverCrop, drawImage, loadImage, optimizeImage, uploadLimit, type Crop, type ImageKind } from './media-processing';
import { assertMediaAlt } from './editor-image';
import { mediaUrl, uploadWebp, type MediaRecord } from './media-transport';

export type MediaTarget = 'body' | 'replace' | 'library' | 'cover';
export type MediaJob = { target: MediaTarget; files?: File[]; position?: number; originalSrc?: string; alt?: string; caption?: string };
type Props = {
  job: MediaJob;
  title: string;
  section: 'life' | 'tech';
  headers: Record<string, string>;
  library: () => Promise<MediaRecord[]>;
  saveMetadata: (record: MediaRecord) => Promise<unknown>;
  apply: (record: MediaRecord, job: MediaJob) => void;
  close: () => void;
};

const sizeText = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(2)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;
const fileKey = (file: File) => JSON.stringify([file.name, file.size, file.lastModified]);
const cropStorageKey = (file: File) => `studio-cover-crop:${JSON.stringify([file.name, file.size, file.type])}`;
const coverScenes = ['首页精选', '普通列表', '技术栏目', '闲聊栏目', '文章详情', '手机列表'] as const;

function useObjectUrl(blob?: Blob) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!blob) { setUrl(''); return; }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

export function MediaEditor({ job, title, section, headers, library, saveMetadata, apply, close }: Props) {
  const isCover = job.target === 'cover';
  const isLibrary = job.target === 'library';
  const multiple = job.target === 'body' || isLibrary;
  const [files, setFiles] = useState(() => Array.from(new Map(job.files?.map((file) => [fileKey(file), file])).values()));
  const [index, setIndex] = useState(0);
  const file = files[index];
  const [source, setSource] = useState<Awaited<ReturnType<typeof loadImage>>>();
  const [output, setOutput] = useState<Awaited<ReturnType<typeof optimizeImage>>>();
  const [crop, setCrop] = useState<Crop>(centeredCrop);
  const [kind, setKind] = useState<ImageKind>('auto');
  const [longest, setLongest] = useState(2560);
  const [original, setOriginal] = useState(false);
  const [alt, setAlt] = useState(job.alt ?? '');
  const [caption, setCaption] = useState(job.caption ?? '');
  const [status, setStatus] = useState('');
  const [problem, setProblem] = useState('');
  const [processedKey, setProcessedKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [items, setItems] = useState<MediaRecord[]>();
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [cropFile, setCropFile] = useState('');
  const [scene, setScene] = useState<(typeof coverScenes)[number]>('首页精选');
  const dialog = useRef<HTMLDialogElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const lock = useRef(false);
  const drag = useRef<{ x: number; y: number; crop: Crop } | null>(null);
  const originalUrl = useObjectUrl(file);
  const outputUrl = useObjectUrl(output?.blob);

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (!file && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [file, busy]);

  useEffect(() => {
    let active = true;
    setSource(undefined);
    setOutput(undefined);
    setProblem('');
    setStatus('');
    setProcessedKey('');
    const cropKey = isCover && file ? cropStorageKey(file) : '';
    let initial = centeredCrop;
    if (cropKey) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(cropKey) ?? 'null');
        if (saved && [saved.x, saved.y, saved.zoom].every(Number.isFinite)) initial = saved;
      } catch { /* Session storage can be unavailable. */ }
    }
    setCrop(initial);
    setCropFile(cropKey);
    setOriginal(false);
    setAlt(job.alt ?? file?.name.replace(/\.[^.]+$/, '').slice(0, 300) ?? '');
    setCaption(job.caption ?? '');
    setWorking(Boolean(file));
    if (file) {
      loadImage(file).then((result) => { if (active) setSource(result); }).catch((error: Error) => {
        if (active) { setProblem(error.message); setWorking(false); }
      });
    }
    return () => { active = false; };
  }, [file, isCover, job.alt, job.caption]);

  useEffect(() => {
    if (!cropFile || !file || cropFile !== cropStorageKey(file)) return;
    try { sessionStorage.setItem(cropFile, JSON.stringify(crop)); } catch { /* The draft and source file remain available. */ }
  }, [crop, cropFile, file]);

  useEffect(() => {
    if (!file || !source) return;
    let active = true;
    setOutput(undefined);
    setProblem('');
    setWorking(true);
    const timer = window.setTimeout(() => {
      optimizeImage(file, source, { crop: isCover ? crop : undefined, kind, longest, keepOriginal: original })
        .then((result) => { if (active) setOutput(result); })
        .catch((error: Error) => { if (active) setProblem(error.message); })
        .finally(() => { if (active) setWorking(false); });
    }, isCover ? 180 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [file, source, isCover, crop, kind, longest, original]);

  useEffect(() => {
    if (canvas.current && source && isCover) {
      drawImage(source.image, canvas.current, { width: 480, height: 270 }, coverCrop(source.size, crop));
    }
  }, [source, isCover, crop]);

  function choose(next: File[]) {
    if (!next.length || lock.current || processedKey) return;
    if (!multiple) { setFiles(next.slice(0, 1)); setIndex(0); return; }
    const unique = Array.from(new Map([...files, ...next].map((item) => [fileKey(item), item])).values());
    setFiles(unique);
    if (unique.length < files.length + next.length) setStatus('已跳过重复选择的文件。');
  }

  function requestClose() {
    if (lock.current) return;
    if (file && !isCover && !window.confirm('关闭并放弃尚未完成的图片队列？')) return;
    close();
  }

  async function submit() {
    if (lock.current || (!output && !processedKey)) return;
    lock.current = true;
    setBusy(true);
    setProblem('');
    let key = processedKey;
    try {
      assertMediaAlt(alt);
      if (!key && output) {
        setStatus('正在上传…');
        key = await uploadWebp(output.blob, headers, (percent) => setStatus(
          percent === null ? '正在上传…' : percent === 100 ? '已发送，等待服务端确认…' : `上传 ${percent}%`,
        ));
        setProcessedKey(key);
      }
      if (!key) return;
      setStatus('正在保存图片描述…');
      const record = { key, alt: alt.trim(), caption: caption.trim() };
      await saveMetadata(record);
      apply(record, job);
      if (index + 1 < files.length) setIndex(index + 1);
      else close();
    } catch (error) {
      setProblem((error as Error).message);
      setStatus(key ? '图片已上传，可重试保存描述。' : '上传未确认。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function loadLibrary() {
    setLoadingLibrary(true);
    setProblem('');
    try { setItems(await library()); }
    catch (error) { setProblem((error as Error).message); }
    finally { setLoadingLibrary(false); }
  }

  const changed = file && output ? (100 * (file.size - output.blob.size) / file.size) : 0;
  const canKeep = source?.format === 'webp' && Boolean(file && file.size <= uploadLimit);
  const fieldDisabled = busy || Boolean(processedKey);
  return (
    <dialog className="media-dialog" ref={dialog} onCancel={(event) => { event.preventDefault(); requestClose(); }}
      aria-labelledby="media-title" onPaste={(event) => {
        const pasted = Array.from(event.clipboardData.files);
        if (pasted.length) { event.preventDefault(); choose(pasted); }
      }}>
      <header className="media-heading">
        <div><h2 id="media-title">{isCover ? '封面工作台' : job.target === 'replace' ? '替换正文图片' : '准备图片'}</h2>
          <p>{isCover ? '16:9 · 1600 × 900 · WebP' : '检查原图、优化结果和替代文本后再上传'}</p></div>
        <button className="media-button" type="button" disabled={busy} onClick={requestClose}>关闭</button>
      </header>
      <input ref={picker} type="file" accept="image/*,.avif,.heic" multiple={multiple} hidden onChange={(event) => {
        choose(Array.from(event.currentTarget.files ?? []));
        event.currentTarget.value = '';
      }} />
      <div className={`media-drop ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)} onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          choose(Array.from(event.dataTransfer.files));
        }}>
        <button className="media-button" type="button" disabled={fieldDisabled} onClick={() => picker.current?.click()}>{file ? '选择其他图片' : '选择图片'}</button>
        <span>或拖入、粘贴图片</span>
        {!isCover && !isLibrary && <button className="media-button" type="button" disabled={busy || loadingLibrary || Boolean(file)} onClick={() => void loadLibrary()}>{loadingLibrary ? '正在读取…' : '从媒体库选择'}</button>}
      </div>
      {items && !file && <div className="media-picker" aria-label="私有媒体库">
        {!items.length && <p>媒体库暂无图片。</p>}
        {items.map((item) => <button key={item.key} type="button" className="media-picker-item" onClick={() => { try { apply(item, job); close(); } catch (error) { setProblem((error as Error).message); } }}>
          <img src={mediaUrl(item.key)} alt="" loading="lazy" /><span>{item.alt || item.key.split('/').pop()}</span>
        </button>)}
      </div>}
      {files.length > 1 && <ol className="media-queue" aria-label="图片上传队列">
        {files.map((queued, i) => <li key={fileKey(queued)} aria-current={i === index ? 'step' : undefined}>
          <span>{queued.name}</span><small>{i < index ? '已完成' : i > index ? '等待处理' : problem ? '需处理' : busy ? '上传中' : '当前图片'}</small>
        </li>)}
      </ol>}
      {file && <div className="media-file">
        <p><strong>{file.name}</strong> · 第 {index + 1} / {files.length} 张</p>
        {!busy && !processedKey && <button className="media-button" type="button" onClick={() => setFiles(files.filter((_, i) => i !== index))}>移出队列</button>}
      </div>}
      {source && file && <div className="media-work">
        <div className="media-compare">
          <figure><img src={originalUrl} alt="原始图片预览" /><figcaption>原图 · {source.size.width} × {source.size.height} · {sizeText(file.size)} · {(source.size.width / source.size.height).toFixed(2)}:1</figcaption></figure>
          <figure>
            {isCover ? <canvas ref={canvas} aria-label="可拖动的封面裁剪预览" onPointerDown={(event) => {
              drag.current = { x: event.clientX, y: event.clientY, crop };
              event.currentTarget.setPointerCapture(event.pointerId);
            }} onPointerMove={(event) => {
              if (!drag.current) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const { x, y, crop: initial } = drag.current;
              const unit = (number: number) => Math.max(0, Math.min(1, number));
              setCrop({ ...initial, x: unit(initial.x - (event.clientX - x) / rect.width), y: unit(initial.y - (event.clientY - y) / rect.height) });
            }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} />
              : outputUrl ? <img src={outputUrl} alt="优化图片预览" /> : <div className="media-skeleton" />}
            <figcaption>{output ? `${output.original ? '保留原 WebP' : 'WebP'} · ${output.size.width} × ${output.size.height} · ${sizeText(output.blob.size)} · ${changed >= 0 ? '减少' : '增加'} ${Math.abs(changed).toFixed(1)}%` : '正在生成预览…'}</figcaption>
          </figure>
        </div>
        <div className="media-fields">
          {isCover ? <>
            <label>缩放 <input type="range" min="1" max="4" step=".01" value={crop.zoom} onChange={(e) => setCrop({ ...crop, zoom: Number(e.target.value) })} /></label>
            <label>水平焦点 <input type="range" min="0" max="1" step=".01" value={crop.x} onChange={(e) => setCrop({ ...crop, x: Number(e.target.value) })} /></label>
            <label>垂直焦点 <input type="range" min="0" max="1" step=".01" value={crop.y} onChange={(e) => setCrop({ ...crop, y: Number(e.target.value) })} /></label>
            <button className="media-button" type="button" onClick={() => setCrop(centeredCrop)}>重置裁剪</button>
          </> : <>
            <label>最长边<select disabled={fieldDisabled || original} value={longest} onChange={(e) => setLongest(Number(e.target.value))}><option value="2560">2560 px</option><option value="1920">1920 px</option><option value="1280">1280 px</option><option value="960">960 px</option><option value="640">640 px</option></select></label>
            {canKeep && <label className="media-check"><input type="checkbox" disabled={fieldDisabled} checked={original} onChange={(e) => setOriginal(e.target.checked)} /> 保留原始 WebP</label>}
          </>}
          <label>图片类型<select disabled={fieldDisabled} value={kind} onChange={(e) => setKind(e.target.value as ImageKind)}><option value="auto">自动</option><option value="photo">照片</option><option value="detail">截图／透明图／线稿</option></select></label>
        </div>
      </div>}
      {!isCover && file && <div className="media-fields">
        <label>替代文本（Alt）<input maxLength={300} value={alt} disabled={busy} onChange={(e) => setAlt(e.target.value)} /></label>
        <label>图注<input maxLength={500} value={caption} disabled={busy} onChange={(e) => setCaption(e.target.value)} /></label>
      </div>}
      {isCover && outputUrl && <div className="media-scenes">
        <label>展示场景<select value={scene} onChange={(e) => setScene(e.target.value as typeof scene)}>{coverScenes.map((name) => <option key={name}>{name}</option>)}</select></label>
        <article className={`media-scene ${scene === '手机列表' ? 'phone' : scene === '文章详情' ? 'detail' : scene === '首页精选' ? 'feature' : ''}`}>
          {scene === '文章详情' && <h3>{title || '未命名文章'}</h3>}
          <img src={outputUrl} alt="所选场景中的封面" />
          {scene !== '文章详情' && <div><small>{scene === '技术栏目' || (scene !== '闲聊栏目' && section === 'tech') ? '技术手记' : '随便聊聊'}</small><h3>{title || '未命名文章'}</h3></div>}
        </article>
      </div>}
      {problem && <p className="media-error" role="alert">{problem}</p>}
      <p className="media-status" role="status">{working ? '正在处理图片…' : status}</p>
      <footer className="media-actions">
        {file && originalUrl && <a className="media-button" href={originalUrl} download={file.name}>下载原图</a>}
        {isCover ? <>
          {output && outputUrl && <a className="media-button primary" href={outputUrl} download="cover-1600x900.webp">导出封面 WebP</a>}
          <p>导出后请使用已有公开封面路径。私有媒体目前仅支持从正文随文章发布。</p>
        </> : <button className="media-button primary" type="button" disabled={busy || working || (!output && !processedKey)} onClick={() => void submit()}>
          {busy ? '正在处理…' : processedKey ? '重试保存描述' : problem && output ? '重试上传' : isLibrary ? '确认上传' : '上传并插入'}
        </button>}
      </footer>
    </dialog>
  );
}
