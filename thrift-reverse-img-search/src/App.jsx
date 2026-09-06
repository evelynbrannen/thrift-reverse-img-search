import { useEffect, useRef, useState, useMemo } from 'react'
import { loadModel, fileToImage, embedImage, makeThumbDataURL, hasSimd } from './lib/embed'
import { loadGallery, search, scoreAll } from './lib/gallery'
import './App.css'

function formatPlace(category) {
  if (!category) return null
  return category.split('/').filter(Boolean).slice(-2).join(' / ')
}

function normalize(s) {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")  // curly quotes
    .replace(/\s+/g, ' ')
}

function textSearch(items, query, limit = 48) {
  const terms = normalize(query).split(' ').filter(Boolean)
  if (!terms.length) return []
  const out = []
  for (const item of items) {
    const hay = normalize(`${item.name} ${item.category}`)
    if (terms.every((t) => hay.includes(t))) {
      out.push({ item })
      if (out.length >= limit) break
    }
  }
  return out
}

function ResultGrid({ entries }) {
  if (!entries?.length) return null
  return (
    <div className="grid">
      {entries.map(({ item, score }) => (
        <figure key={item.id} className="hit">
          <img src={item.thumb} alt={item.name} loading="lazy" />
          <figcaption>
            {score !== undefined && (
              <>
                <div className="meter">
                  <span style={{ width: `${Math.max(0, score) * 100}%` }} />
                </div>
                <span className="score">{score.toFixed(3)}</span>
              </>
            )}
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
  )
}

export default function App() {
  const [status, setStatus] = useState('Loading collection...')
  const [ready, setReady] = useState(false)
  const [items, setItems] = useState([])
  const [galleryMissing, setGalleryMissing] = useState(false)
  const [preview, setPreview] = useState(null)
  const [results, setResults] = useState(null)
  const [scores, setScores] = useState(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [canEmbed, setCanEmbed] = useState(true)

  const searchInput = useRef(null)
  const textResults = useMemo(() => {
    const matches = textSearch(items, query, scores ? Infinity : 48)
    if (!scores) return matches
    return matches
      .map(({ item }) => ({ item, score: scores.get(item.id) ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 48)
  }, [items, query, scores])
  const trimmed = query.trim()

  useEffect(() => {
    ; (async () => {
      try {
        const { items, missing, reason } = await loadGallery()
        setItems(items)
        setGalleryMissing(!!missing)

        if (!hasSimd()) {
          setCanEmbed(false)
          setStatus('Photo search needs a newer device. You can still search by name.')
          return
        }

        setStatus(missing ? reason : 'Loading model (first time only, ~90 MB)...')
        await loadModel((p) => {
          if (p.status === 'progress' && p.total) {
            setStatus(`Loading model: ${Math.round((p.loaded / p.total) * 100)}%`)
          }
        })
        setReady(true)
        if (!missing) setStatus('')
      } catch (e) {
        setCanEmbed(false)
        setStatus('Photo search is unavailable on this device. You can still search by name.')
      }
    })()
  }, [])

  const searchable = items.length > 0

  async function handleSearch(file) {
    if (!file) return
    setBusy(true)
    setPreview(null)
    setResults(null)
    setScores(null)
    try {
      const img = await fileToImage(file)
      setPreview(makeThumbDataURL(img, 320))
      const vec = await embedImage(img)
      setScores(scoreAll(vec, items))
      setResults(search(vec, items, 12))
    } catch (e) {
      setPreview(null)
      setStatus(`Error: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  function clearPhoto() {
    setPreview(null)
    setResults(null)
    setScores(null)
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
        {canEmbed && (
          <button disabled={!ready || busy} onClick={() => searchInput.current.click()}>
            {busy ? 'Looking...' : 'Check an item'}
          </button>
        )}
        <div className={canEmbed ? 'find' : 'find find--solo'}>
          <input
            type="search"
            placeholder={canEmbed ? 'Or search by name' : 'Search by name'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={!searchable}
          />
          {query && (
            <button className="find__clear" onClick={() => setQuery('')} aria-label="Clear search">
              ×
            </button>
          )}
        </div>
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

      {preview || trimmed || results ? (
        <div className={preview ? 'workspace' : 'workspace workspace--full'}>
          {preview && (
            <section className="query">
              <div className="query__head">
                <h2>What you photographed</h2>
                <button className="reset" onClick={clearPhoto}>Clear</button>
              </div>
              <img src={preview} alt="The item you photographed" />
            </section>
          )}

          <section className="matches">
            {trimmed ? (
              <>
                <h2>
                  {textResults.length === 0
                    ? `Nothing matching “${trimmed}”`
                    : scores
                      ? `Best visual matches among ${textResults.length} named “${trimmed}”`
                      : `${textResults.length}${textResults.length === 48 ? '+' : ''} matching “${trimmed}”`}
                  {scores && (
                    <button className="reset" onClick={clearPhoto}>Ignore photo</button>
                  )}
                </h2>
                <ResultGrid entries={textResults} />
              </>
            ) : (
              <>
                <h2>Closest things you own</h2>
                <ResultGrid entries={results} />
              </>
            )}
          </section>
        </div>
      ) : (
        !busy && (
          <p className="empty">
            {canEmbed
              ? 'Photograph something on the shelf and this will show you the closest things already in the collection. Or search by name above.'
              : 'Search the collection by name or category above.'}
          </p>
        )
      )}
    </div>
  )
}