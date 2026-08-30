import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { RuleSetPresetCatalogResponse } from './types'

let request: Promise<RuleSetPresetCatalogResponse> | undefined

export function useRuleSetPresetCatalog(enabled: boolean) {
  const [state, setState] = useState<{
    data?: RuleSetPresetCatalogResponse
    error?: string
    loading: boolean
  }>({ loading: false })

  useEffect(() => {
    if (!enabled) return
    setState((current) => ({ ...current, loading: true }))
    request ||= api<RuleSetPresetCatalogResponse>('/rule-set-presets/catalog')
    let active = true
    request
      .then((data) => active && setState({ data, loading: false }))
      .catch((error) => {
        request = undefined
        if (active) setState({ error: error instanceof Error ? error.message : '社区目录加载失败', loading: false })
      })
    return () => {
      active = false
    }
  }, [enabled])

  return state
}
