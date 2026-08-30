import { Hono } from 'hono'
import { fail, ok } from '../http'

export type GeoCatalog = {
  version: 1
  source: { repository: 'MetaCubeX/meta-rules-dat'; ref: 'meta'; commit?: string; fetchedAt: string }
  geosite: { full: string[]; lite: string[] }
  geoip: { full: string[]; lite: string[] }
}

type TreeItem = { path?: string; type?: string }
const API = 'https://api.github.com/repos/MetaCubeX/meta-rules-dat/git/trees/meta?recursive=1'
const CACHE_KEY = 'https://wangwang.internal/api/geo/catalog'
function validCatalog(value: unknown): value is GeoCatalog {
  if (!value || typeof value !== 'object') return false
  const c = value as Partial<GeoCatalog>
  return (
    c.version === 1 &&
    Boolean(c.source?.fetchedAt) &&
    (['geosite', 'geoip'] as const).every((type) => {
      const group = c[type]
      return Boolean(group) && (['full', 'lite'] as const).every((dataset) => Array.isArray(group?.[dataset]))
    })
  )
}

export function buildGeoCatalog(tree: TreeItem[], fetchedAt = new Date().toISOString(), commit?: string): GeoCatalog {
  const values = {
    geosite: { full: [] as string[], lite: [] as string[] },
    geoip: { full: [] as string[], lite: [] as string[] },
  }
  for (const item of tree) {
    if (item.type !== 'blob' || !item.path?.endsWith('.mrs')) continue
    const match = /^(geo|geo-lite)\/(geosite|geoip)\/([^/]+)\.mrs$/.exec(item.path)
    if (!match) continue
    const dataset = match[1] === 'geo-lite' ? 'lite' : 'full'
    let value = match[3]
    if (match[2] === 'geoip' && /^[a-z]{2}$/i.test(value)) value = value.toUpperCase()
    values[match[2] as 'geosite' | 'geoip'][dataset].push(value)
  }
  for (const type of ['geosite', 'geoip'] as const)
    for (const dataset of ['full', 'lite'] as const) values[type][dataset] = [...new Set(values[type][dataset])].sort()
  return {
    version: 1,
    source: { repository: 'MetaCubeX/meta-rules-dat', ref: 'meta', ...(commit ? { commit } : {}), fetchedAt },
    ...values,
  }
}

export const geoRouter = new Hono<{ Bindings: Env }>()
geoRouter.get('/catalog', async (c) => {
  const type = c.req.query('type')
  const dataset = c.req.query('dataset')
  if (!['geosite', 'geoip'].includes(type || '') || !['full', 'lite'].includes(dataset || ''))
    return fail(c, 400, 'INVALID_GEO_QUERY', 'type 必须是 geosite 或 geoip，dataset 必须是 full 或 lite')
  const cache = await caches.default.match(CACHE_KEY)
  let catalog: GeoCatalog | undefined
  let stale = false
  if (cache) {
    try {
      const value: unknown = await cache.json()
      catalog = validCatalog(value) ? value : undefined
    } catch {
      catalog = undefined
    }
  }
  const fresh = catalog && Date.now() - Date.parse(catalog.source.fetchedAt) < 24 * 3600_000
  if (!fresh) {
    try {
      const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'wangwang' }
      if (c.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${c.env.GITHUB_TOKEN}`
      const response = await fetch(API, { headers })
      if (!response.ok) throw new Error(`GitHub ${response.status}`)
      const payload = (await response.json()) as { tree?: TreeItem[]; sha?: string; truncated?: boolean }
      if (payload.truncated) throw new Error('GitHub tree truncated')
      catalog = buildGeoCatalog(payload.tree || [], new Date().toISOString(), payload.sha)
      await caches.default.put(
        CACHE_KEY,
        new Response(JSON.stringify(catalog), { headers: { 'Cache-Control': 'max-age=86400' } }),
      )
    } catch {
      if (!catalog || Date.now() - Date.parse(catalog.source.fetchedAt) > 7 * 86400_000)
        return fail(c, 503, 'GEO_UNAVAILABLE', 'GEO 数据暂时不可用')
      stale = true
    }
  }
  return ok(c, {
    type,
    dataset,
    items: catalog![type as 'geosite' | 'geoip'][dataset as 'full' | 'lite'],
    source: catalog!.source,
    ...(stale ? { stale: true } : {}),
  })
})
