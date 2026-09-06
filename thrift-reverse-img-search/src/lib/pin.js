const STORAGE_KEY = 'thrift-pin'
const SALT = 'thrift-search-v1'

const PIN_HASH = 'c367450c4573d0f1c372c58895379534a89842f83e17cc281a3a50de48d3844a'

async function hash(pin) {
  const bytes = new TextEncoder().encode(SALT + pin)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function checkPin(pin) {
  return (await hash(pin)) === PIN_HASH
}

export const remember = (pin) => localStorage.setItem(STORAGE_KEY, pin)
export const stored = () => localStorage.getItem(STORAGE_KEY)
export const forget = () => localStorage.removeItem(STORAGE_KEY)