"""Prepare the supplied raster wordmark for compact light/dark sidebar use."""
import sys
from pathlib import Path
from PIL import Image

source = Image.open(sys.argv[1]).convert('RGB')
out = Path(__file__).resolve().parents[1] / 'public'
mask = source.point(lambda v: 255 - v).convert('L').point(lambda v: 255 if v > 45 else 0)
box = mask.getbbox()
image = source.crop(box)
# The supplied artwork has a wide gap between FOR and STEP.
split = round(image.width * 0.56)
parts = [image.crop((0, 0, split, image.height)), image.crop((split, 0, image.width, image.height))]
for dark in (False, True):
    rows = []
    for index, part in enumerate(parts):
        rgba = Image.new('RGBA', part.size)
        pixels = []
        for r, g, b in part.getdata():
            alpha = 255 - min(r, g, b)
            if alpha < 35:
                pixels.append((0, 0, 0, 0))
            elif index == 0:
                pixels.append((235, 235, 235, alpha) if dark else (20, 20, 20, alpha))
            else:
                pixels.append((r, g, b, min(255, round(alpha * 4))))
        rgba.putdata(pixels)
        rgba = rgba.crop(rgba.getbbox())
        width = 800 if index == 0 else 1000
        rows.append(rgba.resize((width, round(rgba.height * width / rgba.width)), Image.Resampling.LANCZOS))
    canvas = Image.new('RGBA', (1000, sum(row.height for row in rows) + 24))
    y = 0
    for row in rows:
        canvas.alpha_composite(row, ((canvas.width - row.width) // 2, y))
        y += row.height + 24
    canvas.save(out / f'wordmark-{"dark" if dark else "light"}.png')
