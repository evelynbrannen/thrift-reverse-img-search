import json, os
from pathlib import Path
from PIL import Image, ImageOps
import pillow_heif
from tqdm import tqdm

pillow_heif.register_heif_opener()

SRC = Path(os.environ["IMG_DIR"])
OUT = Path("site/thumbs"); OUT.mkdir(parents=True, exist_ok=True)
EXTS = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".tif", ".tiff"}
MAX_SIDE = 320

paths = sorted(p for p in SRC.rglob("*") if p.suffix.lower() in EXTS)
print(f"found {len(paths)} images")

manifest = []
for i, p in enumerate(tqdm(paths)):
    try:
        im = Image.open(p)
        im = ImageOps.exif_transpose(im).convert("RGB")
    except Exception as e:
        print(f"skip {p.name}: {e}")
        continue
    w, h = im.size
    thumb = im.copy()
    thumb.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    name = f"{i:05d}.webp"
    thumb.save(OUT / name, "WEBP", quality=80, method=6)
    manifest.append({
        "id": i,
        "source": str(p.relative_to(SRC)),
        "thumb": f"thumbs/{name}",
        "w": w, "h": h,
    })

Path("site").mkdir(exist_ok=True)
Path("site/manifest.json").write_text(json.dumps(manifest))
print(f"wrote {len(manifest)} thumbs")