from PIL import Image
from pathlib import Path

src = Path(
    r"C:\Users\sithu\.cursor\projects\c-Users-sithu-Projects-arb-guardian\assets"
    r"\c__Users_sithu_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_image-6f6e5af8-0be8-42b6-9b43-2b6bc12e86bd.png"
)
img = Image.open(src).convert("RGBA")
pixels = img.load()
w, h = img.size

for y in range(h):
    for x in range(w):
        r, g, b, a = pixels[x, y]
        if r < 28 and g < 28 and b < 28:
            pixels[x, y] = (0, 0, 0, 0)
            continue
        if r < 40 and g < 40 and b < 45 and (r + g + b) < 110:
            pixels[x, y] = (r, g, b, 0)

bbox = img.getbbox()
if bbox:
    left, top, right, bottom = bbox
    pad = 24
    left = max(0, left - pad)
    top = max(0, top - pad)
    right = min(w, right + pad)
    bottom = min(h, bottom + pad)
    img = img.crop((left, top, right, bottom))

side = max(img.size)
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
ox = (side - img.size[0]) // 2
oy = (side - img.size[1]) // 2
canvas.paste(img, (ox, oy), img)

logo = canvas.resize((1024, 1024), Image.Resampling.LANCZOS)
favicon = canvas.resize((256, 256), Image.Resampling.LANCZOS)

out_docs = Path("docs/assets/logo.png")
out_web = Path("apps/web/public/logo.png")
out_fav = Path("apps/web/public/favicon.png")
out_docs.parent.mkdir(parents=True, exist_ok=True)
Path("apps/web/public").mkdir(parents=True, exist_ok=True)

logo.save(out_docs, "PNG", optimize=True)
logo.save(out_web, "PNG", optimize=True)
favicon.save(out_fav, "PNG", optimize=True)
print("saved", out_docs, out_web, out_fav)
print("size", logo.size, "mode", logo.mode)
