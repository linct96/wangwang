import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { RuleSetPresetCatalogResponse } from './types'

let inFlightRequest: Promise<RuleSetPresetCatalogResponse> | undefined
let cachedCatalog: RuleSetPresetCatalogResponse | undefined
let cachedAt = 0
const CACHE_TTL = 10 * 60 * 1000

function loadCatalog(force = false) {
  if (!force && cachedCatalog && Date.now() - cachedAt < CACHE_TTL) return Promise.resolve(cachedCatalog)
  if (inFlightRequest) return inFlightRequest
  inFlightRequest = api<RuleSetPresetCatalogResponse>('/rule-set-presets/catalog')
    .then((data) => {
      cachedCatalog = data
      cachedAt = Date.now()
      return data
    })
    .finally(() => {
      inFlightRequest = undefined
    })
  return inFlightRequest
}

export function useRuleSetPresetCatalog(enabled: boolean) {
  const [state, setState] = useState<{
    data?: RuleSetPresetCatalogResponse
    error?: string
    loading: boolean
  }>({ data: cachedCatalog, loading: false })

  useEffect(() => {
    if (!enabled) return
    setState((current) => ({ ...current, loading: true }))
    let active = true
    loadCatalog()
      .then((data) => active && setState({ data, loading: false }))
      .catch(
        (error) =>
          active &&
          setState({
            data: cachedCatalog,
            error: error instanceof Error ? error.message : '社区目录加载失败',
            loading: false,
          }),
      )
    return () => {
      active = false
    }
  }, [enabled])

  function reload() {
    setState((current) => ({ ...current, loading: true, error: undefined }))
    loadCatalog(true)
      .then((data) => setState({ data, loading: false }))
      .catch((error) =>
        setState({
          data: cachedCatalog,
          error: error instanceof Error ? error.message : '社区目录加载失败',
          loading: false,
        }),
      )
  }

  return { ...state, reload }
}
