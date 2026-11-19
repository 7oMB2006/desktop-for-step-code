const glyphs: Record<string, string> = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111',
  3: '111001111001111', 4: '101101111001001', 5: '111100111001111',
  6: '111100111101111', 7: '111001001001001', 8: '111101111101111',
  9: '111101111001111', '+': '000010111010000',
};

export const taskbarBadgeSize = 16;

export function taskbarBadgeBitmap(count: number): Buffer {
  const size = taskbarBadgeSize;
  const pixels = Buffer.alloc(size * size * 4);
  const text = count > 9 ? '9+' : String(count);
  const scale = text.length === 1 ? 2 : 1;
  const width = (text.length * 4 - 1) * scale;
  const left = (size - width) >> 1;
  const top = (size - 5 * scale) >> 1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const distance = Math.hypot(x + .5 - size / 2, y + .5 - size / 2);
    if (distance >= size / 2) continue;
    const col = Math.floor((x - left) / scale);
    const row = Math.floor((y - top) / scale);
    const ink = col >= 0 && col < width / scale && row >= 0 && row < 5 && col % 4 < 3
      && glyphs[text[Math.floor(col / 4)]]?.[row * 3 + col % 4] === '1';
    const offset = (y * size + x) * 4;
    // Electron's native bitmap uses BGRA on Windows.
    pixels.set(ink ? [255, 255, 255, 255] : distance > 6.8 ? [238, 238, 238, 255] : [177, 70, 35, 255], offset);
  }
  return pixels;
}

export class TaskbarBadge {
  private unread = new Set<string>();
  private applied?: { count: number; language: string };

  constructor(private options: {
    foreground: (id: string) => boolean;
    archived: (id: string) => boolean;
    language: () => string;
    apply: (count: number, description: string) => boolean;
  }) {}

  complete(id: string) {
    if (!this.options.foreground(id) && !this.options.archived(id)) this.unread.add(id);
    this.sync();
  }

  clear(id: string) {
    this.unread.delete(id);
    this.sync();
  }

  sync(force = false) {
    for (const id of this.unread)
      if (this.options.foreground(id) || this.options.archived(id)) this.unread.delete(id);
    const count = this.unread.size;
    const language = this.options.language();
    if (!force && this.applied?.count === count && this.applied.language === language) return;
    const description = !count ? '' : language === 'zh' ? `${count} 个会话有未读回复`
      : count === 1 ? '1 conversation with an unread reply' : `${count} conversations with unread replies`;
    if (this.options.apply(count, description)) this.applied = { count, language };
  }
}
