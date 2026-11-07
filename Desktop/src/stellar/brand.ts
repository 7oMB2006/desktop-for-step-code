type Region = { image: HTMLImageElement; x: number; y: number; width: number; height: number; mark: boolean };
type Star = { x: number; y: number; size: number; phase: number; color: string; mark: boolean; flare: boolean };

/** A small 2D lockup: retain the source artwork, without a permanent extra WebGL context. */
export class StellarBrandRenderer {
  private context: CanvasRenderingContext2D;
  private stars: Star[] = [];
  private regions: Region[] = [];
  private width = 0;
  private height = 0;
  private time = 0;
  private emphasis = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Brand canvas unavailable');
    this.context = context;
  }

  resize(host: HTMLElement, mark: HTMLImageElement, wordmark: HTMLImageElement) {
    const box = host.getBoundingClientRect();
    this.width = Math.round(box.width); this.height = Math.round(box.height);
    // Twice-resolution sampling preserves the small English counters at 100% DPI.
    this.canvas.width = this.width * 2; this.canvas.height = this.height * 2;
    this.regions = [mark, wordmark].map((image, index) => {
      const r = image.getBoundingClientRect();
      return { image, x: r.left - box.left, y: r.top - box.top, width: r.width, height: r.height, mark: index === 0 };
    });
    const mask = document.createElement('canvas');
    mask.width = this.canvas.width; mask.height = this.canvas.height;
    const ctx = mask.getContext('2d', { willReadFrequently: true })!;
    ctx.scale(2, 2);
    for (const r of this.regions) ctx.drawImage(r.image, r.x, r.y, r.width, r.height);
    const pixels = ctx.getImageData(0, 0, mask.width, mask.height).data;
    const edge = this.regions[0].x + this.regions[0].width + 1;
    let seed = 60626;
    const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 | 0) >>> 0) / 4294967296;
    this.stars = [];
    for (let y = 0; y < this.height; y += .48) for (let x = 0; x < this.width; x += .48) {
      const px = x + random() * .4, py = y + random() * .4;
      const index = (Math.floor(py * 2) * mask.width + Math.floor(px * 2)) * 4;
      if (pixels[index + 3] < 100 || random() < .12) continue;
      const isMark = px < edge;
      this.stars.push({ x: px, y: py, size: (isMark ? .45 : .3) + random() ** 3 * .5,
        phase: random() * Math.PI * 2, mark: isMark, flare: isMark && random() > .985,
        color: `rgb(${pixels[index]},${pixels[index + 1]},${pixels[index + 2]})` });
    }
  }

  draw(delta: number, motion: boolean, active: boolean) {
    if (motion) this.time += delta;
    this.emphasis = motion ? this.emphasis + (Number(active) - this.emphasis) * (1 - Math.exp(-delta * 9)) : Number(active);
    const ctx = this.context;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.globalCompositeOperation = 'source-over';
    // The smaller wordmark keeps a quiet continuous core; the symbol is mostly stars.
    for (const r of this.regions) {
      ctx.globalAlpha = r.mark ? .13 : .58;
      ctx.drawImage(r.image, r.x, r.y, r.width, r.height);
      if (!r.mark) {
        ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.width, r.height * .4); ctx.clip();
        ctx.globalAlpha = .5; ctx.drawImage(r.image, r.x, r.y, r.width, r.height); ctx.restore();
      }
    }
    ctx.globalCompositeOperation = 'screen';
    const wave = (Math.sin(this.time * .45) * .5 + .5) * this.width;
    for (const star of this.stars) {
      const breath = .72 + .28 * Math.sin(this.time * .65 + star.phase);
      const ridge = Math.exp(-(((star.x - wave) / 26) ** 2));
      ctx.globalAlpha = Math.min(1, breath * (star.mark ? .84 : .5) + ridge * this.emphasis * .45);
      ctx.fillStyle = star.color;
      ctx.fillRect(star.x - star.size / 2, star.y - star.size / 2, star.size, star.size);
      if (star.flare) {
        ctx.globalAlpha *= .25 + this.emphasis * .2;
        ctx.fillRect(star.x - 1.2, star.y - .12, 2.4, .24);
        ctx.fillRect(star.x - .12, star.y - 1.2, .24, 2.4);
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  dispose() {
    this.stars = []; this.regions = [];
    this.canvas.width = this.canvas.height = 0;
  }
}
