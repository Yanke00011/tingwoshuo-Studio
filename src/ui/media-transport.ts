export interface MediaRecord { key: string; alt: string; caption: string }
export function mediaUrl(key: string) {
  // The Markdown exporter expects this exact private reference format.
  return `/api/media/object?key=${key}`;
}

export async function uploadWebp(blob: Blob, headers: Record<string, string>, progress: (value: number | null) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/media');
    request.timeout = 120_000;
    request.setRequestHeader('Content-Type', 'image/webp');
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => progress(event.lengthComputable && event.total ? Math.floor(100 * event.loaded / event.total) : null);
    request.onload = () => {
      try {
        const item = JSON.parse(request.responseText);
        if (request.status >= 200 && request.status < 300 && /^private\/[a-f0-9-]{36}\.webp$/.test(item.key)) {
          resolve(item.key);
        } else reject(Error(item.error || `上传失败（HTTP ${request.status}）`));
      } catch {
        reject(Error('上传响应无法确认。请先检查媒体库或登录状态，再决定是否重试。'));
      }
    };
    request.onerror = request.ontimeout = () => reject(Error('连接中断或超时。服务端可能已接收图片，请先检查媒体库再重试。'));
    request.send(blob);
  });
}
