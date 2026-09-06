import json, sys
import numpy as np, torch
from PIL import Image, ImageOps
import pillow_heif
from transformers import AutoImageProcessor, AutoModel

pillow_heif.register_heif_opener()
MODEL = "facebook/dinov2-small"

E = np.load("embeddings_f32.npy")
manifest = json.loads(open("site/manifest.json").read())
device = "mps" if torch.backends.mps.is_available() else "cpu"
proc = AutoImageProcessor.from_pretrained(MODEL)
model = AutoModel.from_pretrained(MODEL).to(device).eval()

im = ImageOps.exif_transpose(Image.open(sys.argv[1])).convert("RGB")
with torch.inference_mode():
    out = model(**proc(images=[im], return_tensors="pt").to(device)).last_hidden_state
    q = torch.cat([out[:, 0], out[:, 1:].mean(dim=1)], dim=-1)
    q = torch.nn.functional.normalize(q, dim=-1).float().cpu().numpy()[0]

scores = E @ q
for i in np.argsort(-scores)[:8]:
    print(f"{scores[i]:.3f}  {manifest[i]['source']}")