import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Neutral grain modulates the shared effort palette, so no second color ramp is baked in.
const target = fileURLToPath(new URL('../src/stellar/effort-sea-grain.png', import.meta.url));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const image = await page.evaluate(() => {
    const scale = 2, width = 72, height = 216, w = width * scale, h = height * scale;
    const light = new Float32Array(w * h);
    let seed = 606111;
    const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 | 0) >>> 0) / 4294967296;
    const center = y => width * .5 + Math.sin(y / height * Math.PI * 2 - .65) * 2;
    const edge = x => Math.min(1, Math.max(0, Math.min(x, width - x) / 3));
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      const x = px / scale, y = py / scale, distance = x - center(y);
      const dust = Math.exp(-(distance ** 2) / 600) * (.04 + random() * .045);
      light[py * w + px] = .018 + dust * edge(x);
    }
    const star = (x, y, radius, energy) => {
      const reach = Math.ceil(radius * 3 * scale), cx = x * scale, cy = y * scale;
      for (let py = Math.max(0, Math.floor(cy - reach)); py < Math.min(h, cy + reach); py++)
        for (let px = Math.max(0, Math.floor(cx - reach)); px < Math.min(w, cx + reach); px++) {
          const distance = ((px + .5 - cx) ** 2 + (py + .5 - cy) ** 2) / (radius * scale) ** 2;
          light[py * w + px] += Math.exp(-distance * 1.8) * energy * edge(x);
        }
    };
    for (let i = 0; i < 7200; i++) {
      const y = random() * height, x = 1 + random() * (width - 2);
      const field = .7 + .3 * Math.exp(-((x - center(y)) ** 2) / 600);
      const knot = .8 + .2 * Math.abs(Math.sin(y * .067 + x * .04));
      const radius = .22 + random() ** 3 * .6;
      const energy = (.4 + random() ** 2 * 1.5) * knot * field;
      star(x, y, radius, energy);
      if (i % 17 === 0) star(x, y, 1.6 + random() * 1.4, .035);
    }
    // Distribute short traces across the field instead of aligning them on visible tracks.
    for (let i = 0; i < 120; i++) {
      const y = random() * height, x = 2 + random() * (width - 4), length = 3 + random() * 4;
      for (let step = 0; step < 12; step++) {
        const along = step / 11, at = (y + along * length) % height;
        star(x + center(at) - center(y), at, .3, .16 * (1 - along) ** 1.5);
      }
    }
    for (let i = 0; i < 65; i++) {
      const x = 5 + random() * (width - 10), y = random() * height;
      star(x, y, .35 + random() * .35, .5 + random() * .65);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const context = canvas.getContext('2d'), pixels = context.createImageData(w, h);
    for (let i = 0; i < light.length; i++) {
      const value = Math.round(Math.min(1, light[i]) * 255);
      pixels.data.set([value, value, value, 255], i * 4);
    }
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const bytes = Buffer.from(image, 'base64');
  await writeFile(target, bytes);
  console.log(JSON.stringify({ target, bytes: bytes.length }));
} finally {
  await browser.close();
}
