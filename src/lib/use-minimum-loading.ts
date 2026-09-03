import { useEffect, useRef, useState } from 'react'

export function useMinimumLoading(loading: boolean, minimumMs = 500) {
  const startedAt = useRef(loading ? Date.now() : 0)
  const [visible, setVisible] = useState(loading)

  useEffect(() => {
    if (loading) {
      startedAt.current = Date.now()
      setVisible(true)
      return
    }

    if (!visible) return
    const timer = window.setTimeout(() => setVisible(false), Math.max(0, minimumMs - (Date.now() - startedAt.current)))
    return () => window.clearTimeout(timer)
  }, [loading, minimumMs, visible])

  return loading || visible
}
