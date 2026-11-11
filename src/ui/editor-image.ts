import type { Editor } from '@tiptap/core';

export type SelectedImage = {
  position: number;
  src: string;
  alt: string;
  caption: string;
};

export function imageAt(editor: Editor, position: number): SelectedImage | undefined {
  if (position < 0 || position >= editor.state.doc.content.size) return;
  const node = editor.state.doc.nodeAt(position);
  if (node?.type.name !== 'image') return;
  const next = editor.state.doc.nodeAt(position + node.nodeSize);
  // The legacy editor writes captions as a single italic paragraph.
  const caption = next?.type.name === 'paragraph' && next.childCount === 1 &&
    next.firstChild?.isText && next.firstChild.marks.length === 1 && next.firstChild.marks[0].type.name === 'italic'
    ? next.textContent : '';
  return { position, src: node.attrs.src, alt: node.attrs.alt ?? '', caption };
}

export function assertMediaAlt(alt: string) {
  if (/[\[\]\r\n]/.test(alt)) throw Error('Alt 请使用普通文字，不包含方括号或换行，以兼容现有 Markdown 发布格式。');
}

export function captionNode(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'italic' }] }] };
}

export function updateImage(editor: Editor, selected: SelectedImage, alt: string, caption: string, src = selected.src) {
  assertMediaAlt(alt);
  const current = imageAt(editor, selected.position);
  if (!current || current.src !== selected.src || current.alt !== selected.alt || current.caption !== selected.caption) {
    throw Error('原图片的位置已变化，请重新选择后再试。');
  }
  const node = editor.state.doc.nodeAt(selected.position)!;
  const from = selected.position + node.nodeSize;
  const previousCaption = current.caption ? editor.state.doc.nodeAt(from) : null;
  const { schema, tr } = editor.state;
  tr.setNodeMarkup(selected.position, undefined, { ...node.attrs, src, alt, title: src === selected.src ? node.attrs.title : null });
  if (caption !== current.caption) {
    const to = from + (previousCaption?.nodeSize ?? 0);
    if (caption) tr.replaceWith(from, to, schema.nodeFromJSON(captionNode(caption)));
    else if (previousCaption) tr.delete(from, to);
  }
  editor.view.dispatch(tr);
}
