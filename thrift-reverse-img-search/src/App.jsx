import { useEffect, useRef, useState } from 'react'
import { loadModel, fileToImage, embedImage, makeThumbDataURL } from './lib/embed'
import { loadGallery, search } from './lib/gallery'
import './App.css'

function formatPlace(category) {
  if (!category) return null
  return category.split('/').filter(Boolean).slice(-2).join(' / ')
}

export default function App() {
  const [status, setStatus] = useState('Loading collection...')
  const [ready, setReady] = useState(false)
  const [items, setItems] = useState([])
  const [galleryMissing, setGalleryMissing] = useState(false)
  const [preview, setPreview] = useState(null)
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)

  const searchInput = useRef(null)

  useEffect(() => {
    ;(async () => {
      try {
        const { items, missing, reason } = await loadGallery()
        setItems(items)
        setGalleryMissing(!!missing)
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

  async function handleSearch(file) {
    if (!file) return
    setBusy(true)
    setResults(null)
    try {
      const img = await fileToImage(file)
      setPreview(makeThumbDataURL(img, 320))
      const vec = await embedImage(img)
      setResults(search(vec, items, 12))
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <header>
        <h1>Thrift reverse image search</h1>
        <p className="count">
          {galleryMissing ? 'No collection loaded yet' : `${items.length} items`}
        </p>
      </header>

      {status && <p className="status">{status}</p>}

      <div className="actions">
        <button disabled={!ready || busy} onClick={() => searchInput.current.click()}>
          {busy ? 'Looking...' : 'Check an item'}
        </button>
      </div>

      <input
        ref={searchInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          handleSearch(e.target.files[0])
          e.target.value = ''
        }}
      />

      {!results && !busy && (
        <p className="empty">
          Photograph something on the shelf and this will show you the closest
          things already in the collection.
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
                  <img src={item.thumb} alt={item.name} loading="lazy" />
                  <figcaption>
                    <div className="meter">
                      <span style={{ width: `${Math.max(0, score) * 100}%` }} />
                    </div>
                    <span className="score">{score.toFixed(3)}</span>
                    {item.category && (
                      <span className="place" title={item.category}>
                        {formatPlace(item.category)}
                      </span>
                    )}
                    <span className="label" title={item.name}>{item.name}</span>
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