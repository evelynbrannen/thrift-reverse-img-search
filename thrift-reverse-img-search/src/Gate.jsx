import { useEffect, useState } from 'react'
import { checkPin, remember, stored } from './lib/pin'
import './Gate.css'

export default function Gate({ children }) {
  const [unlocked, setUnlocked] = useState(false)
  const [checking, setChecking] = useState(true)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const saved = stored()
    if (!saved) return setChecking(false)
    checkPin(saved).then((ok) => {
      setUnlocked(ok)
      setChecking(false)
    })
  }, [])

  async function submit() {
    if (await checkPin(pin)) {
      remember(pin)
      setUnlocked(true)
    } else {
      setError('That PIN does not match.')
      setPin('')
    }
  }

  if (checking) return null
  if (unlocked) return children

  return (
    <div className="gate">
      <div className="gate__panel">
        <h1>Enter your PIN</h1>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          autoFocus
          onChange={(e) => { setPin(e.target.value); setError('') }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button onClick={submit} disabled={!pin}>Unlock</button>
        {error && <p className="gate__error">{error}</p>}
      </div>
    </div>
  )
}