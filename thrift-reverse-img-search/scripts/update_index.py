import hashlib, json, os
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageOps
import pillow_heif
from transformers import AutoImageProcessor, AutoModel
from tqdm import tqdm

pillow_heif.register_heif_opener()

SRC = Path(os.environ["IMG_DIR"]).expanduser()
SITE = Path("site")
THUMBS = SITE / "thumbs"
MODEL = "facebook/dinov2-small"
MAX_SIDE = 320
BATCH = 16
EXTS = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".tif", ".tiff"}


def content_key(p, head=262144):
    """Identify an image by its bytes, not its location."""
    st = p.stat()
    h = hashlib.sha1(str(st.st_size).encode())
    with open(p, "rb") as f:
        h.update(f.read(head))
        if st.st_size > head * 2:
            f.seek(-head, os.SEEK_END)
            h.update(f.read(head))
    return h.hexdigest()[:16]


def make_thumb(job):
    rel, ck, out_path = job
    try:
        im = Image.open(SRC / rel)
        im.draft("RGB", (MAX_SIDE * 2, MAX_SIDE * 2))
        im = ImageOps.exif_transpose(im).convert("RGB")
        w, h = im.size
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        im.save(out_path, "WEBP", quality=80, method=4)
        return ck, w, h, None
    except Exception as e:
        return ck, None, None, str(e)


def main():
    THUMBS.mkdir(parents=True, exist_ok=True)

    # --- what's on disk now: path -> content key ---
    current = {}
    for p in SRC.rglob("*"):
        if p.suffix.lower() not in EXTS or p.name.startswith("."):
            continue
        current[str(p.relative_to(SRC))] = content_key(p)
    print(f"{len(current)} images on disk")

    # --- what we already have: content key -> (vector, w, h) ---
    cached = {}
    if (SITE / "manifest.json").exists() and Path("embeddings_f32.npy").exists():
        old = json.loads((SITE / "manifest.json").read_text())
        vecs = np.load("embeddings_f32.npy")
        for i, r in enumerate(old):
            ck = r.get("chash")
            if ck and ck not in cached and (THUMBS / f"{ck}.webp").exists():
                cached[ck] = (vecs[i], r["w"], r["h"])

    # one representative file per unseen image
    need = {}
    for rel, ck in sorted(current.items()):
        if ck not in cached:
            need.setdefault(ck, rel)
    print(f"{len(cached)} reused, {len(need)} to process")

    # --- thumbnails, in parallel ---
    dims = {}
    if need:
        jobs = [(rel, ck, THUMBS / f"{ck}.webp") for ck, rel in need.items()]
        with ProcessPoolExecutor() as pool:
            for ck, w, h, err in tqdm(pool.map(make_thumb, jobs), total=len(jobs), desc="thumbs"):
                if err:
                    print(f"skip {need[ck]}: {err}")
                else:
                    dims[ck] = (w, h)
        need = {ck: rel for ck, rel in need.items() if ck in dims}

    # --- embeddings for the new ones only ---
    fresh = {}
    if need:
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        print("device:", device)
        proc = AutoImageProcessor.from_pretrained(MODEL)
        model = AutoModel.from_pretrained(MODEL).to(device).eval()
        keys = list(need)

        with torch.inference_mode():
            for s in tqdm(range(0, len(keys), BATCH), desc="embed"):
                chunk = keys[s : s + BATCH]
                imgs = [
                    ImageOps.exif_transpose(Image.open(SRC / need[ck])).convert("RGB")
                    for ck in chunk
                ]
                inputs = proc(images=imgs, return_tensors="pt").to(device)
                out = model(**inputs).last_hidden_state
                emb = torch.cat([out[:, 0], out[:, 1:].mean(dim=1)], dim=-1)
                emb = torch.nn.functional.normalize(emb, dim=-1).float().cpu().numpy()
                for ck, v in zip(chunk, emb):
                    fresh[ck] = (v, *dims[ck])

    # --- assemble in folder order ---
    records, vectors = [], []
    for rel in sorted(current):
        ck = current[rel]
        entry = cached.get(ck) or fresh.get(ck)
        if entry is None:
            continue
        vec, w, h = entry
        path = Path(rel)
        records.append({
            "id": len(records),
            "source": rel,
            "name": path.stem,
            "category": str(path.parent) if str(path.parent) != "." else "",
            "thumb": f"thumbs/{ck}.webp",
            "chash": ck,
            "w": w,
            "h": h,
        })
        vectors.append(vec)

    E = np.stack(vectors).astype(np.float32)

    # --- drop thumbnails no longer referenced ---
    keep = {r["chash"] + ".webp" for r in records}
    removed = 0
    for f in THUMBS.glob("*.webp"):
        if f.name not in keep:
            f.unlink()
            removed += 1

    np.save("embeddings_f32.npy", E)
    E.astype(np.float16).tofile(SITE / "embeddings.f16.bin")
    (SITE / "manifest.json").write_text(json.dumps(records))
    (SITE / "embed_meta.json").write_text(json.dumps({
        "model": MODEL, "count": int(E.shape[0]), "dim": int(E.shape[1]),
        "dtype": "float16", "pooling": "cls+meanpatch", "normalized": True,
    }))
    print(f"indexed {len(records)} images, pruned {removed} stale thumbs")
    

if __name__ == "__main__":
    main()