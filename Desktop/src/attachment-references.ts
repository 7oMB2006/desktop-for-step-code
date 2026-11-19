const headers = [
  '以下是用户明确附加的本地文件路径。它们不是已解析的模型输入；如需内容，请按当前权限使用工具读取。不要假定 Word/PPT 等格式能直接解析：',
  'The user attached these local file paths. They are not parsed model inputs. Use tools under the current permissions to read them if needed; do not assume Word/PPT can be parsed directly:',
];
export interface AttachmentReference { path: string; name: string }

/** Recognize only the complete, trailing Desktop-generated reference block. */
export function attachmentPresentation(text: string): { draft: string; files: AttachmentReference[] } | undefined {
  for (const header of headers) {
    const start = text.lastIndexOf(header);
    if (start < 0 || start > 0 && text.slice(start - 2, start) !== '\n\n') continue;
    const lines = text.slice(start + header.length).split('\n');
    if (lines.shift() !== '' || !lines.length || lines.length > 10) continue;
    const files: AttachmentReference[] = [];
    for (const line of lines) {
      const match = /^- ("(?:[^"\\]|\\.)*") \(("(?:[^"\\]|\\.)*")\)$/u.exec(line);
      if (!match) break;
      try {
        const path: unknown = JSON.parse(match[1]), name: unknown = JSON.parse(match[2]);
        if (typeof path !== 'string' || typeof name !== 'string' || !name
          || !/^(?:[a-z]:[\\/]|\\\\|\/)/iu.test(path)
          || path.split(/[\\/]/u).at(-1) !== name) break;
        files.push({ path, name });
      } catch { break; }
    }
    if (files.length === lines.length) return { draft: text.slice(0, Math.max(0, start - 2)), files };
  }
}
