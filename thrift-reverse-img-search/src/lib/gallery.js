import { l2normalize } from './embed'

const B = import.meta.env.BASE_URL

function f16ToF32(h) {
    const s = (h & 0x8000) >> 15
    const e = (h & 0x7c00) >> 10
    const f = h & 0x03ff
    if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024)
    if (e === 0x1f) return f ? NaN : (s ? -Infinity : Infinity)
    return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024)
}

export class MissingAssetError extends Error {
    constructor(url) {
        super(`Missing ${url}. Run the update script to build the collection index.`)
        this.name = 'MissingAssetError'
        this.missing = true
    }
}

async function fetchJSON(url) {
    const res = await fetch(url)
    const type = res.headers.get('content-type') || ''
    if (!res.ok || !type.includes('application/json')) {
        throw new MissingAssetError(url)
    }
    return res.json()
}

export async function loadGallery() {
    let manifest, meta, buf
    try {
        ;[manifest, meta] = await Promise.all([
            fetchJSON(`${B}manifest.json`),
            fetchJSON(`${B}embed_meta.json`),
        ])
        const res = await fetch(`${B}embeddings.f16.bin`)
        if (!res.ok) throw new MissingAssetError(`${B}embeddings.f16.bin`)
        buf = await res.arrayBuffer()
        // A missing path can return index.html, so check the actual bytes.
        if (new Uint8Array(buf.slice(0, 1))[0] === 0x3c) {
            throw new MissingAssetError(`${B}embeddings.f16.bin`)
        }
    } catch (e) {
        if (e.missing) return { items: [], dim: 0, missing: true, reason: e.message }
        throw e
    }

    const u16 = new Uint16Array(buf)
    const { count, dim } = meta
    if (u16.length !== count * dim) {
        throw new Error(
            `Embedding size mismatch: file has ${u16.length} values, manifest expects ${count} × ${dim}. ` +
            `Re-run the update script so the two stay in sync.`
        )
    }

    const items = manifest.map((rec, i) => {
        const v = new Float32Array(dim)
        for (let j = 0; j < dim; j++) v[j] = f16ToF32(u16[i * dim + j])
        return {
            id: rec.id,
            name: rec.name || rec.source,
            category: rec.category || '',
            thumb: B + rec.thumb,
            vec: l2normalize(v),
        }
    })

    return { items, dim, missing: false }
}

export function search(query, items, k = 12) {
    const scored = items.map((it) => {
        let s = 0
        for (let j = 0; j < query.length; j++) s += query[j] * it.vec[j]
        return { item: it, score: s }
    })
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, k)
}