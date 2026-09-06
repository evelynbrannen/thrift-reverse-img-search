import { useEffect, useRef, useState } from 'react'
import { loadModel, fileToImage, embedImage, makeThumbDataURL } from './lib/embed'
import { loadGallery, search } from './lib/gallery'
import { addItem, getItems, deleteItem } from './lib/store'
import './App.css'

export default function App() {
  const [status, setStatus] = useState('Loading gallery...')
  const [ready, setReady] = useState(false)
  const [baseItems, setBaseItems] = useState([])
  const [localItems, setLocalItems] = useState([])
  const [preview, setPreview] = useState(null)
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)
  const [galleryMissing, setGalleryMissing] = useState(false)

  const searchInput = useRef(null)
  const addInput = useRef(null)

  useEffect(() => {
    ; (async () => {
      try {
        const { items, missing, reason } = await loadGallery()
        setBaseItems(items)
        setGalleryMissing(!!missing)
        setLocalItems(await getItems())
        setStatus(missing ? reason : 'Loading model (first time only, ~90 MB)...')
        await loadModel((p) => {
          if (p.status === 'progress' && p.total) {
            setStatus(`Loading model: ${Math.round((p.loaded / p.total) * 100)}%`)
          }
        })
        setReady(true)
        if (!missing) setStatus('')
      } catch (e) {
        setStatus(`Error: ${e.message}`)
      }
    })()
  }, [])

  const allItems = [...baseItems, ...localItems]

  async function handleSearch(file) {
    if (!file) return
    setBusy(true)
    setResults(null)
    try {
      const img = await fileToImage(file)
      setPreview(makeThumbDataURL(img, 320))
      const vec = await embedImage(img)
      setResults(search(vec, allItems, 12))
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleAdd(files) {
    if (!files?.length) return
    setBusy(true)
    try {
      const added = []
      for (const file of files) {
        const img = await fileToImage(file)
        const thumb = makeThumbDataURL(img, 320)
        const vec = await embedImage(img)
        added.push(await addItem({ label: file.name, thumb, vec }))
      }
      setLocalItems((prev) => [...prev, ...added])
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id) {
    await deleteItem(id)
    setLocalItems((prev) => prev.filter((i) => i.id !== id))
  }

  function handleExport() {
    const payload = localItems.map(({ id, label, thumb, vec, addedAt }) => ({
      id, label, thumb, addedAt, vec: Array.from(vec),
    }))
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'local-additions.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="app">
      <header>
        <h1>Thrift reverse image search</h1>
        <p className="count">
          {galleryMissing
            ? 'No catalogue loaded yet'
            : `${baseItems.length} catalogued`}
          {localItems.length > 0 && ` + ${localItems.length} added here`}
        </p>
      </header>

      {status && <p className="status">{status}</p>}

      <div className="actions">
        <button disabled={!ready || busy} onClick={() => searchInput.current.click()}>
          {busy ? 'Working...' : 'Check an item'}
        </button>
        <button
          className="secondary"
          disabled={!ready || busy}
          onClick={() => addInput.current.click()}
        >
          Add purchased item
        </button>
        {localItems.length > 0 && (
          <button className="secondary" onClick={handleExport}>
            Export additions
          </button>
        )}
      </div>

      <input
        ref={searchInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => { handleSearch(e.target.files[0]); e.target.value = '' }}
      />
      <input
        ref={addInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => { handleAdd([...e.target.files]); e.target.value = '' }}
      />

            {!results && !busy && (
        <p className="empty">
          Photograph something on the shelf and this will show you the closest
          things already in your collection.
        </p>
      )}

      {results && (
        <div className="workspace">
          <section className="query">
            <h2>What you photographed</h2>
            <img src={preview} alt="The item you photographed" />
          </section>

          <section className="matches">
            <h2>Closest things you own</h2>
            <div className="grid">
              {results.map(({ item, score }) => (
                <figure key={item.id} className="hit">
                  <img src={item.thumb} alt={item.label} loading="lazy" />
                  <figcaption>
                    <div className="meter">
                      <span style={{ width: `${Math.max(0, score) * 100}%` }} />
                    </div>
                    <span className="score">{score.toFixed(3)}</span>
                    <span className="label" title={item.label}>{item.label}</span>
                    {item.id.startsWith('local-') && (
                      <button className="link" onClick={() => handleDelete(item.id)}>
                        Remove
                      </button>
                    )}
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}