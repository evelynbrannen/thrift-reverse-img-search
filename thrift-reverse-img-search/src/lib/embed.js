import { AutoProcessor, AutoModel, RawImage, env } from '@huggingface/transformers'

export function hasSimd() {
  try {
    return WebAssembly.validate(new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0,
      1, 5, 1, 96, 0, 1, 123,
      3, 2, 1, 0,
      10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
    ]))
  } catch {
    return false
  }
}

// Single-threaded wasm avoids needing COOP/COEP headers on your host.
env.backends.onnx.wasm.numThreads = 1

const MODEL_ID = 'Xenova/dinov2-small'

let processorPromise = null
let modelPromise = null

export async function loadModel(onProgress) {
  if (!processorPromise) processorPromise = AutoProcessor.from_pretrained(MODEL_ID)
  if (!modelPromise) {
    modelPromise = AutoModel.from_pretrained(MODEL_ID, {
      dtype: 'fp32', // must match the fp32 PyTorch gallery embeddings
      progress_callback: onProgress,
    })
  }
  return { processor: await processorPromise, model: await modelPromise }
}

// <img> applies EXIF orientation automatically, which canvas/ImageBitmap does not.
export function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
    img.src = url
  })
}

function drawToCanvas(img, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.round(img.naturalWidth * scale)
  const h = Math.round(img.naturalHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d').drawImage(img, 0, 0, w, h)
  return canvas
}

export function makeThumbDataURL(img, maxSide = 320) {
  return drawToCanvas(img, maxSide).toDataURL('image/webp', 0.8)
}

export async function embedImage(img) {
  const { processor, model } = await loadModel()
  const canvas = drawToCanvas(img, 1024)
  const ctx = canvas.getContext('2d')
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)

  const raw = new RawImage(new Uint8ClampedArray(data), width, height, 4).rgb()
  const inputs = await processor(raw)
  const { last_hidden_state } = await model(inputs)

  const [, seq, dim] = last_hidden_state.dims
  const d = last_hidden_state.data

  // CLS token, then mean over patch tokens. Mirrors embed.py.
  const out = new Float32Array(dim * 2)
  for (let j = 0; j < dim; j++) out[j] = d[j]
  const nPatch = seq - 1
  for (let t = 1; t < seq; t++) {
    const off = t * dim
    for (let j = 0; j < dim; j++) out[dim + j] += d[off + j]
  }
  for (let j = 0; j < dim; j++) out[dim + j] /= nPatch

  return l2normalize(out)
}

export function l2normalize(v) {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i] * v[i]
  const n = Math.sqrt(s) || 1
  for (let i = 0; i < v.length; i++) v[i] /= n
  return v
}