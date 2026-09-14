# montage.py <out.png> <label1> <file1> [<label2> <file2> ...]
# One contact sheet of figure crops for the ChatGPT app (each attachment counts against the app's file cap):
# tiles in two columns, each crop scaled to at most 700 px wide, its label drawn above it.
import sys
from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1]
pairs = list(zip(sys.argv[2::2], sys.argv[3::2]))
TILE_W, PAD, LABEL_H, COLS = 700, 16, 28, 2
try:
    font = ImageFont.truetype("arial.ttf", 20)
except Exception:
    font = ImageFont.load_default()
tiles = []
for label, f in pairs:
    im = Image.open(f).convert("RGB")
    w, h = im.size
    if w > TILE_W:
        im = im.resize((TILE_W, max(1, round(h * TILE_W / w))), Image.LANCZOS)
    tiles.append((label, im))
rows = (len(tiles) + COLS - 1) // COLS
col_w = TILE_W + 2 * PAD
row_h = [0] * rows
for i, (_, im) in enumerate(tiles):
    r = i // COLS
    row_h[r] = max(row_h[r], im.size[1] + LABEL_H + 2 * PAD)
sheet = Image.new("RGB", (col_w * min(COLS, len(tiles)), sum(row_h)), "white")
draw = ImageDraw.Draw(sheet)
y = 0
for r in range(rows):
    for c in range(COLS):
        i = r * COLS + c
        if i >= len(tiles):
            break
        label, im = tiles[i]
        x = c * col_w
        draw.rectangle([x + PAD - 2, y + PAD + LABEL_H - 2, x + PAD + im.size[0] + 1, y + PAD + LABEL_H + im.size[1] + 1], outline="red", width=2)
        draw.text((x + PAD, y + PAD), label, fill="black", font=font)
        sheet.paste(im, (x + PAD, y + PAD + LABEL_H))
    y += row_h[r]
sheet.save(out, "PNG", optimize=True)
print(out, sheet.size[0], sheet.size[1], len(tiles))
