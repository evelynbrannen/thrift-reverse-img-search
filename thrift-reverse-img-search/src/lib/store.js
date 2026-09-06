const DB = 'thrift-store'
const STORE = 'items'

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx(mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = fn(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
  )
}

export async function addItem({ label, thumb, vec }) {
  const rec = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label,
    thumb,
    vec: Array.from(vec),
    addedAt: new Date().toISOString(),
  }
  await tx('readwrite', (s) => s.put(rec))
  return { ...rec, vec: new Float32Array(rec.vec) }
}

export async function getItems() {
  const rows = await tx('readonly', (s) => s.getAll())
  return rows.map((r) => ({ ...r, vec: new Float32Array(r.vec) }))
}

export async function deleteItem(id) {
  return tx('readwrite', (s) => s.delete(id))
}