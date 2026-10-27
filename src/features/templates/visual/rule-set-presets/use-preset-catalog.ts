import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { api } from '@/api/client'
import type { RuleSetPresetCatalogResponse } from './types'

const STORAGE_KEY = 'wangwang:rule-set-presets:v1'
const CACHE_TTL = 10 * 60 * 1000
const sourceSchema = z.object({
  updatedAt: z.iso.datetime(),
  checkedAt: z.iso.datetime().optional(),
  revision: z.string(),
  stale: z.boolean().optional(),
})
const catalogSchema: z.ZodType<RuleSetPresetCatalogResponse> = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional(),
        source: z.enum(['metacubex', 'loyalsoldier']),
        category: z.enum(['common', 'ai', 'social', 'media', 'ads', 'china', 'development', 'service']),
        provider: z.object({
          name: z.string(),
          type: z.literal('http'),
          behavior: z.enum(['domain', 'ipcidr', 'classical']),
          format: z.enum(['mrs', 'yaml', 'text']).optional(),
          url: z.url({ protocol: /^https?$/ }),
          path: z.string().optional(),
          interval: z.number().optional(),
        }),
        defaultTarget: z.string().optional(),
        noResolve: z.boolean().optional(),
        keywords: z.array(z.string()).optional(),
      }),
    )
    .min(1),
  updatedAt: z.iso.datetime().nullable(),
  checkedAt: z.iso.datetime().optional(),
  revision: z.string().nullable(),
  stale: z.boolean(),
  sources: z.object({ metacubex: sourceSchema, loyalsoldier: sourceSchema }).optional(),
})

function readCachedCatalog() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? catalogSchema.parse(JSON.parse(saved)) : undefined
  } catch {
    return undefined
  }
}

let cachedCatalog = readCachedCatalog()
let cachedAt = 0
const requests = new Map<'read' | 'sync', Promise<RuleSetPresetCatalogResponse>>()

function loadCatalog(mode: 'read' | 'sync' | 'force' = 'read') {
  const syncing = requests.get('sync')
  if (mode === 'read' && syncing) return syncing
  if (mode === 'read' && cachedCatalog && Date.now() - cachedAt < CACHE_TTL) return Promise.resolve(cachedCatalog)
  const key = mode === 'read' ? 'read' : 'sync'
  const pending = requests.get(key)
  if (pending) return pending
  const request = api<RuleSetPresetCatalogResponse>(
    mode === 'read' ? '/rule-set-presets/catalog' : `/rule-set-presets/sync${mode === 'force' ? '?force=true' : ''}`,
    { method: mode === 'read' ? 'GET' : 'POST', signal: AbortSignal.timeout(30_000) },
  )
    .then((response) => {
      const parsed = catalogSchema.safeParse(response)
      if (!parsed.success) throw new Error('社区目录数据格式异常，请稍后重试')
      let data = !parsed.data.updatedAt && cachedCatalog?.updatedAt ? { ...cachedCatalog, stale: true } : parsed.data
      // 服务端尚无某来源的快照时，仍保留浏览器中缓存的社区条目。
      const missingSources = (['metacubex', 'loyalsoldier'] as const).filter((source) => {
        const snapshot = data.sources?.[source]
        return snapshot?.stale && Date.parse(snapshot.updatedAt) === 0
      })
      if (cachedCatalog && missingSources.length) {
        const ids = new Set(data.items.map((item) => item.id))
        data = {
          ...data,
          items: [
            ...data.items,
            ...cachedCatalog.items.filter((item) => missingSources.includes(item.source) && !ids.has(item.id)),
          ],
        }
      }
      cachedCatalog = data
      cachedAt = Date.now()
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      } catch {
        // 存储被禁用或空间不足时，仍保留本次会话的目录。
      }
      return data
    })
    .finally(() => requests.delete(key))
  requests.set(key, request)
  return request
}

export function useRuleSetPresetCatalog(enabled: boolean) {
  const [state, setState] = useState<{
    enabled: boolean
    data?: RuleSetPresetCatalogResponse
    error?: string
    loading: boolean
  }>({ enabled, data: cachedCatalog, loading: enabled })
  const [refreshCount, setRefreshCount] = useState(0)
  const previousRefresh = useRef(0)

  if (state.enabled !== enabled) {
    setState({ enabled, data: cachedCatalog || state.data, loading: enabled })
  }

  useEffect(() => {
    if (!enabled) return
    let active = true
    const force = refreshCount !== previousRefresh.current
    previousRefresh.current = refreshCount
    async function refresh() {
      let data = await loadCatalog(force ? 'force' : 'read')
      if (!active) return
      if (!force && data.stale) {
        setState({ enabled, data, loading: true })
        data = await loadCatalog('sync')
      }
      if (active) setState({ enabled, data, loading: false })
    }
    refresh().catch((error) => {
      if (!active) return
      setState({
        enabled,
        data: cachedCatalog,
        error:
          error instanceof Error && error.name === 'TimeoutError'
            ? '社区目录更新超时，请重试'
            : error instanceof Error
              ? error.message
              : '社区目录更新失败，请重试',
        loading: false,
      })
    })
    return () => {
      active = false
    }
  }, [enabled, refreshCount])

  return {
    data: state.data,
    error: state.error,
    loading: state.loading,
    reload: () => {
      setState((current) => ({ ...current, data: cachedCatalog || current.data, loading: true, error: undefined }))
      setRefreshCount((count) => count + 1)
    },
  }
}
