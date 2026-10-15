import { useEffect, useMemo, useState } from 'react'
import { api } from '@/api/client'
import type { GeoCatalogResponse, GeoCatalogType, GeoProvider } from './geo-catalog'
type Result = GeoCatalogResponse
const cache = new Map<string, Promise<Result>>()
export function useGeoCatalog(
  type: GeoCatalogType,
  provider: GeoProvider,
): { data?: Result; error?: string; loading: boolean } {
  const query = useMemo(() => ({ type, provider }), [type, provider])
  const [state, setState] = useState<{ query: typeof query; data?: Result; error?: string }>()
  useEffect(() => {
    if (query.provider === 'custom') return
    const key = `${query.type}:${query.provider}`
    const request = cache.get(key) || api<Result>(`/geo/catalog?type=${query.type}&provider=${query.provider}`)
    cache.set(key, request)
    let active = true
    request
      .then((data) => active && setState({ query, data }))
      .catch((e) => {
        if (cache.get(key) === request) cache.delete(key)
        if (active) setState({ query, error: e instanceof Error ? e.message : '请求失败' })
      })
    return () => {
      active = false
    }
  }, [query])
  if (provider === 'custom') return { loading: false }
  return state?.query === query ? { data: state.data, error: state.error, loading: false } : { loading: true }
}
