import json, os
import numpy as np, torch
from pathlib import Path
from PIL import Image, ImageOps
import pillow_heif
from transformers import AutoImageProcessor, AutoModel
from tqdm import tqdm

pillow_heif.register_heif_opener()

MODEL = "facebook/dinov2-small"
SRC = Path(os.environ["IMG_DIR"])
BATCH = 16

manifest = json.loads(Path("site/manifest.json").read_text())
device = "mps" if torch.backends.mps.is_available() else "cpu"
print("device:", device)

proc = AutoImageProcessor.from_pretrained(MODEL)
model = AutoModel.from_pretrained(MODEL).to(device).eval()

def load(rec):
    im = Image.open(SRC / rec["source"])
    return ImageOps.exif_transpose(im).convert("RGB")

vecs = []
with torch.inference_mode():
    for s in tqdm(range(0, len(manifest), BATCH)):
        batch = [load(r) for r in manifest[s:s + BATCH]]
        inputs = proc(images=batch, return_tensors="pt").to(device)
        out = model(**inputs).last_hidden_state
        cls = out[:, 0]                       # CLS token
        mean = out[:, 1:].mean(dim=1)         # mean of patch tokens
        emb = torch.cat([cls, mean], dim=-1)  # 768-dim for dinov2-small
        emb = torch.nn.functional.normalize(emb, dim=-1)
        vecs.append(emb.float().cpu().numpy())

E = np.concatenate(vecs).astype(np.float32)
print("embeddings:", E.shape)

np.save("embeddings_f32.npy", E)                      # local search / experiments
E.astype(np.float16).tofile("site/embeddings.f16.bin")  # for the browser
Path("site/embed_meta.json").write_text(json.dumps({
    "model": MODEL, "count": int(E.shape[0]), "dim": int(E.shape[1]),
    "dtype": "float16", "pooling": "cls+meanpatch", "normalized": True,
}))