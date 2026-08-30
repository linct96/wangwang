import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { GeoCatalogResponse, GeoCatalogType, GeoProvider } from './geo-catalog'
type Result = GeoCatalogResponse
const cache = new Map<string, Promise<Result>>()
export function useGeoCatalog(type: GeoCatalogType, provider: GeoProvider) {
  const key = `${type}:${provider}`
  const [state, setState] = useState<{ data?: Result; error?: string; loading: boolean }>({ loading: true })
  useEffect(() => {
    if (provider === 'custom') {
      setState({ loading: false })
      return
    }
    const request = cache.get(key) || api<Result>(`/geo/catalog?type=${type}&provider=${provider}`)
    cache.set(key, request)
    let active = true
    request
      .then((data) => active && setState({ data, loading: false }))
      .catch((e) => {
        cache.delete(key)
        if (active) setState({ error: e instanceof Error ? e.message : '请求失败', loading: false })
      })
    return () => {
      active = false
    }
  }, [key, type, provider])
  return state
}
