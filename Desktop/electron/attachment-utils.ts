import { basename, win32 } from 'node:path';

export const MAX_ATTACHMENTS = 10;
export const MAX_IMAGES = 5;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export function imageMime(bytes: Buffer): typeof IMAGE_MIMES[number] | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function decodeImageUrl(url: unknown) {
  if (typeof url !== 'string' || url.length > 14000000) throw new Error('Invalid image');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  if (!match) throw new Error('Unsupported image');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Image exceeds 10 MiB');
  if (bytes.toString('base64') !== match[2] || imageMime(bytes) !== match[1]) throw new Error('Invalid image');
  return { bytes, mimeType: match[1] };
}

export function imageFileName(name: string, mimeType: string) {
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
  let stem = win32.basename(name).replace(/\.[^.]*$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '').slice(0, 120);
  if (!stem || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) stem = 'image';
  return `${stem}.${extension}`;
}

export function fileReferenceMessage(message: string, paths: string[], language: 'zh' | 'en'): string {
  if (!paths.length) return message;
  const header = language === 'zh'
    ? '以下是用户明确附加的本地文件路径。它们不是已解析的模型输入；如需内容，请按当前权限使用工具读取。不要假定 Word/PPT 等格式能直接解析：'
    : 'The user attached these local file paths. They are not parsed model inputs. Use tools under the current permissions to read them if needed; do not assume Word/PPT can be parsed directly:';
  return `${message}${message ? '\n\n' : ''}${header}\n${paths.map(path => `- ${JSON.stringify(path)} (${JSON.stringify(basename(path))})`).join('\n')}`;
}
