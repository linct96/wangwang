import { Hono } from 'hono'
import { fail, ok } from '../http'
export type GeoProvider = 'metacubex' | 'metacubex-lite' | 'loyalsoldier' | 'custom'
export type GeoType = 'geosite' | 'geoip'
type TreeItem = { path?: string; type?: string }
const EXTRA = ['china-list', 'apple-cn', 'google-cn', 'win-spy', 'win-update', 'win-extra']
const LOYALSOLDIER_SOURCES = {
  geoipCatalog: { repo: 'Loyalsoldier/geoip', ref: 'release', path: 'dat' },
  geositeCatalog: { repo: 'v2fly/domain-list-community', ref: 'master', path: 'data' },
} as const
const CACHE_BASE = 'https://wangwang.internal/api/geo/catalog'
function pathItem(provider: Exclude<GeoProvider, 'custom'>, type: GeoType, path: string) {
  if (provider === 'loyalsoldier')
    return type === 'geoip' && path.startsWith(`${LOYALSOLDIER_SOURCES.geoipCatalog.path}/`) && path.endsWith('.dat')
      ? path.slice(4, -4).toLowerCase()
      : type === 'geosite' && path.startsWith(`${LOYALSOLDIER_SOURCES.geositeCatalog.path}/`) && !path.includes('/', 5)
        ? path.slice(5)
        : null
  const m = /^(geo|geo-lite)\/(geosite|geoip)\/([^/]+)\.mrs$/.exec(path)
  return m && m[2] === type && (provider === 'metacubex' ? m[1] === 'geo' : m[1] === 'geo-lite') ? m[3] : null
}
async function getGeoCatalog(provider: Exclude<GeoProvider, 'custom'>, type: GeoType, token?: string) {
  const cacheKey = `${CACHE_BASE}?provider=${provider}&type=${type}`
  const cached = await caches.default.match(cacheKey)
  const hit = cached ? ((await cached.json()) as { items: string[]; updatedAt: string }) : undefined
  if (hit && Date.now() - Date.parse(hit.updatedAt) < 86400000) return { ...hit, stale: false }
  const repo =
    provider === 'loyalsoldier'
      ? type === 'geosite'
        ? LOYALSOLDIER_SOURCES.geositeCatalog.repo
        : LOYALSOLDIER_SOURCES.geoipCatalog.repo
      : 'MetaCubeX/meta-rules-dat'
  const ref =
    provider === 'loyalsoldier'
      ? type === 'geosite'
        ? LOYALSOLDIER_SOURCES.geositeCatalog.ref
        : LOYALSOLDIER_SOURCES.geoipCatalog.ref
      : 'meta'
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'wangwang' }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`https://api.github.com/repos/${repo}/git/trees/${ref}?recursive=1`, { headers })
  if (!response.ok) throw new Error(`GitHub ${response.status}`)
  const payload = (await response.json()) as { tree?: TreeItem[]; truncated?: boolean }
  if (payload.truncated) throw new Error('GitHub tree truncated')
  const items = (payload.tree || [])
    .filter((i) => i.type === 'blob')
    .map((i) => {
      const value = i.path && pathItem(provider, type, i.path)
      if (value && provider !== 'loyalsoldier' && type === 'geoip' && /^[a-z]{2}$/i.test(value))
        return value.toUpperCase()
      return value
    })
    .filter((v): v is string => Boolean(v))
  const merged = provider === 'loyalsoldier' && type === 'geosite' ? [...items, ...EXTRA] : items
  const result = { items: [...new Set(merged)].sort(), updatedAt: new Date().toISOString() }
  await caches.default.put(
    cacheKey,
    new Response(JSON.stringify(result), { headers: { 'Cache-Control': 'max-age=604800' } }),
  )
  return { ...result, stale: false }
}
export const geoRouter = new Hono<{ Bindings: Env }>()
geoRouter.get('/catalog', async (c) => {
  const type = c.req.query('type') as GeoType,
    provider = c.req.query('provider') as GeoProvider
  if (
    !['geosite', 'geoip'].includes(type) ||
    !['metacubex', 'metacubex-lite', 'loyalsoldier', 'custom'].includes(provider)
  )
    return fail(c, 400, 'INVALID_GEO_QUERY', 'type 或 provider 无效')
  if (provider === 'custom') return fail(c, 400, 'UNSUPPORTED_GEO_PROVIDER', 'Custom 不提供 catalog')
  try {
    return ok(c, { provider, type, ...(await getGeoCatalog(provider, type, c.env.GITHUB_TOKEN)) })
  } catch {
    const staleResponse = await caches.default.match(`${CACHE_BASE}?provider=${provider}&type=${type}`)
    const stale = staleResponse ? ((await staleResponse.json()) as { items: string[]; updatedAt: string }) : undefined
    if (!stale || Date.now() - Date.parse(stale.updatedAt) > 7 * 86400000)
      return fail(c, 503, 'GEO_UNAVAILABLE', 'GEO 数据暂时不可用')
    return ok(c, { provider, type, ...stale, stale: true })
  }
})
