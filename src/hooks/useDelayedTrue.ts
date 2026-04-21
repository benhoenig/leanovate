import { useEffect, useState } from 'react'

/**
 * Returns `true` only after `source` has been `true` for `delayMs` straight.
 * Flips back to `false` immediately when `source` becomes `false`.
 *
 * Used to suppress skeleton flash on fast loads — below the threshold the user
 * sees nothing, then the real content. Above it they get a skeleton until data
 * arrives, which feels smoother than a mid-load pop-in.
 */
export function useDelayedTrue(source: boolean, delayMs = 150): boolean {
  const [delayed, setDelayed] = useState(false)

  useEffect(() => {
    if (!source) return
    const id = setTimeout(() => setDelayed(true), delayMs)
    return () => {
      clearTimeout(id)
      setDelayed(false)
    }
  }, [source, delayMs])

  return source ? delayed : false
}
