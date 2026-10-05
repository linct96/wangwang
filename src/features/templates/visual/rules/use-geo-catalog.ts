import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { GeoCatalogResponse, GeoCatalogType, GeoProvider } from './geo-catalog'
type Result = GeoCatalogResponse
const cache = new Map<string, Promise<Result>>()
export function useGeoCatalog(
  type: GeoCatalogType,
  provider: GeoProvider,
): { data?: Result; error?: string; loading: boolean } {
  const key = `${type}:${provider}`
  const [state, setState] = useState<{ key: string; data?: Result; error?: string; loading: boolean }>({
    key,
    loading: provider !== 'custom',
  })
  useEffect(() => {
    if (provider === 'custom') return
    setState({ key, loading: true })
    const request = cache.get(key) || api<Result>(`/geo/catalog?type=${type}&provider=${provider}`)
    cache.set(key, request)
    let active = true
    request
      .then((data) => active && setState({ key, data, loading: false }))
      .catch((e) => {
        if (cache.get(key) === request) cache.delete(key)
        if (active) setState({ key, error: e instanceof Error ? e.message : '请求失败', loading: false })
      })
    return () => {
      active = false
    }
  }, [key, type, provider])
  if (provider === 'custom') return { loading: false }
  return state.key === key ? state : { loading: true }
}
