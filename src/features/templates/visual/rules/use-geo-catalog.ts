import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { GeoCatalogType, GeoDataset } from './geo-catalog'
type Result = {
  type: GeoCatalogType
  dataset: GeoDataset
  items: string[]
  source: { fetchedAt: string }
  stale?: boolean
}
const cache = new Map<string, Promise<Result>>()
export function useGeoCatalog(type: GeoCatalogType, dataset: GeoDataset) {
  const key = `${type}:${dataset}`
  const [state, setState] = useState<{ data?: Result; error?: string; loading: boolean }>({ loading: true })
  useEffect(() => {
    const request = cache.get(key) || api<Result>(`/geo/catalog?type=${type}&dataset=${dataset}`)
    cache.set(key, request)
    let active = true
    request
      .then((data) => active && setState({ data, loading: false }))
      .catch((e) => active && setState({ error: e instanceof Error ? e.message : '请求失败', loading: false }))
    return () => {
      active = false
    }
  }, [key, type, dataset])
  return state
}
