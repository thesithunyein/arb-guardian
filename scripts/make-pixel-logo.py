from pathlib import Path

from PIL import Image, ImageDraw

W, H = 32, 32
px = Image.new("RGBA", (W, H), (0, 0, 0, 0))

NAVY = (11, 18, 32, 255)
INK = (5, 8, 16, 255)
LIME = (229, 255, 93, 255)
LIME_D = (168, 196, 28, 255)
BLUE = (45, 120, 255, 255)
BLUE_D = (22, 72, 190, 255)
BLUE_L = (140, 196, 255, 255)
GOLD = (255, 209, 102, 255)
GOLD_D = (230, 150, 20, 255)
WHITE = (255, 255, 255, 255)

pixels: dict[tuple[int, int], tuple[int, int, int, int]] = {}


def put(x: int, y: int, c: tuple[int, int, int, int]) -> None:
    if 0 <= x < W and 0 <= y < H:
        pixels[(x, y)] = c


# rounded square badge background (Codedex course-card feel)
for y in range(2, 30):
    for x in range(2, 30):
        edge = x in (2, 29) or y in (2, 29)
        corner = (x, y) in {(2, 2), (2, 29), (29, 2), (29, 29)}
        if corner:
            continue
        put(x, y, INK if edge else NAVY)

# outer lime frame
for i in range(3, 29):
    put(i, 3, LIME)
    put(i, 28, LIME)
    put(3, i, LIME)
    put(28, i, LIME)

rows = {
    6: [(11, 20)],
    7: [(9, 22)],
    8: [(8, 23)],
    9: [(7, 24)],
    10: [(7, 24)],
    11: [(7, 24)],
    12: [(7, 24)],
    13: [(7, 24)],
    14: [(7, 24)],
    15: [(8, 23)],
    16: [(8, 23)],
    17: [(9, 22)],
    18: [(10, 21)],
    19: [(11, 20)],
    20: [(12, 19)],
    21: [(13, 18)],
    22: [(14, 17)],
    23: [(15, 16)],
}

for y, ranges in rows.items():
    for a, b in ranges:
        for x in range(a, b + 1):
            put(x, y, INK)

for y, ranges in rows.items():
    for a, b in ranges:
        for x in range(a + 1, b):
            if y <= 8:
                put(x, y, BLUE_L)
            elif y >= 20:
                put(x, y, BLUE_D)
            else:
                put(x, y, BLUE)
        put(a + 1, y, LIME)
        put(b - 1, y, LIME)

for x in range(11, 21):
    put(x, 6, LIME)
    put(x, 7, LIME_D if x % 2 == 0 else LIME)

put(15, 22, LIME)
put(16, 22, LIME)
put(15, 23, LIME)
put(16, 23, LIME)

# gold asset gem (guild treasury mark)
gem = [
    (14, 12),
    (15, 12),
    (16, 12),
    (17, 12),
    (13, 13),
    (14, 13),
    (15, 13),
    (16, 13),
    (17, 13),
    (18, 13),
    (13, 14),
    (14, 14),
    (15, 14),
    (16, 14),
    (17, 14),
    (18, 14),
    (14, 15),
    (15, 15),
    (16, 15),
    (17, 15),
]
for x, y in gem:
    put(x, y, GOLD_D)
put(14, 13, WHITE)
put(15, 13, GOLD)
put(16, 13, GOLD)
put(15, 14, GOLD)

# cardinal ticks
put(15, 10, LIME)
put(16, 10, LIME)
put(15, 11, LIME_D)
put(16, 11, LIME_D)
put(15, 17, LIME_D)
put(16, 17, LIME_D)
put(15, 18, LIME)
put(16, 18, LIME)
put(11, 14, LIME)
put(12, 14, LIME_D)
put(19, 14, LIME_D)
put(20, 14, LIME)

for (x, y), c in pixels.items():
    px.putpixel((x, y), c)

large = px.resize((512, 512), Image.NEAREST)
fav = px.resize((64, 64), Image.NEAREST)

out = Path(__file__).resolve().parents[1]
(out / "apps" / "web" / "public" / "logo.png").parent.mkdir(parents=True, exist_ok=True)
(out / "docs" / "assets").mkdir(parents=True, exist_ok=True)

large.save(out / "apps" / "web" / "public" / "logo.png", "PNG")
large.save(out / "docs" / "assets" / "logo.png", "PNG")
fav.save(out / "apps" / "web" / "public" / "favicon.png", "PNG")

# README-friendly banner badge (dark tile)
tile = Image.new("RGBA", (640, 640), NAVY)
tile.paste(large, (64, 64), large)
draw = ImageDraw.Draw(tile)
# lime outer stroke
for t in range(8):
    draw.rectangle([t, t, 639 - t, 639 - t], outline=LIME if t < 4 else LIME_D)
tile.save(out / "docs" / "assets" / "logo-readme.png", "PNG")
print("logos written")
