"""Regenerate the WebP copies in src/uploads/optimized/ used by the home page,
team grid and project tiles (smaller than the WordPress originals).

    python3 scripts/optimize-images.py     # needs Pillow

Run it after changing a member photo or project image in src/_data/*.json
(point the JSON at the original upload, run this, then switch it to the
optimized path it prints)."""
import json, os, sys
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'src')
OUT = os.path.join(ROOT, 'uploads', 'optimized')
os.makedirs(OUT, exist_ok=True)


def webp(src, name, width=None, square=None, quality=82):
    im = Image.open(os.path.join(ROOT, src.lstrip('/')))
    alpha = im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info)
    im = im.convert('RGBA' if alpha else 'RGB')
    if square:
        w, h = im.size
        s = min(w, h)
        im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))
        im = im.resize((min(square, s), min(square, s)), Image.LANCZOS)
    elif width and im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    path = os.path.join(OUT, name)
    im.save(path, 'WEBP', quality=quality, method=6)
    print(f'/uploads/optimized/{name}  {im.size[0]}x{im.size[1]}  {os.path.getsize(path) // 1024} KB')


if __name__ == '__main__':
    members = json.load(open(os.path.join(ROOT, '_data', 'members.json')))
    for m in members['current']:
        src = m.get('photoOriginal') or m['photo']
        if not src.startswith('/uploads/optimized/'):
            webp(src, f"team-{m['slug']}.webp", square=600, quality=80)
    print('Done. Point members.json "photo" at /uploads/optimized/team-<slug>.webp and keep the original in "photoOriginal".')
    sys.exit(0)
