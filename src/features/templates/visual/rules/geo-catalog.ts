import { parse } from 'yaml'
import type { GeoSettingsDraft } from '../model'
export type GeoCatalogType = 'geosite' | 'geoip'
export type GeoProvider = 'metacubex' | 'metacubex-lite' | 'loyalsoldier' | 'custom'
export type GeoCatalogResponse = {
  provider: Exclude<GeoProvider, 'custom'>
  type: GeoCatalogType
  items: string[]
  updatedAt: string
  stale: boolean
}
export function detectGeoSource(yaml: string, type: 'GEOSITE' | 'GEOIP'): { provider: GeoProvider } {
  let config: Record<string, unknown> = {}
  try {
    config = (parse(yaml) || {}) as Record<string, unknown>
  } catch {
    return { provider: 'custom' }
  }
  const geodataMode = config['geodata-mode'] === true
  const geox = (config['geox-url'] || {}) as Record<string, unknown>
  const source = type === 'GEOSITE' ? String(geox.geosite || '') : String(geox[geodataMode ? 'geoip' : 'mmdb'] || '')
  return { provider: inferProvider(source, type) }
}
function inferProvider(source: string, type: 'GEOSITE' | 'GEOIP'): GeoProvider {
  if (!source) return 'custom'
  const match = /github\.com\/([^/]+)\/([^/?#]+)/i.exec(source)
  if (!match) return 'custom'
  const owner = match[1].toLowerCase(),
    repo = match[2].toLowerCase()
  if (owner === 'metacubex' && repo === 'meta-rules-dat') {
    const file = source.split(/[/?#]/).filter(Boolean).at(-1)?.toLowerCase() || ''
    return (
      type === 'GEOSITE' ? file === 'geosite-lite.dat' : file === 'geoip-lite.dat' || file === 'country-lite.mmdb'
    )
      ? 'metacubex-lite'
      : 'metacubex'
  }
  if (owner === 'loyalsoldier' && repo === 'v2ray-rules-dat') return 'loyalsoldier'
  return 'custom'
}
export function inferGeoSource(geo: GeoSettingsDraft, type: 'GEOSITE' | 'GEOIP'): { provider: GeoProvider } {
  const mode = geo.geodataMode === true
  const source = type === 'GEOSITE' ? geo.geoxUrl.geosite : geo.geoxUrl[mode ? 'geoip' : 'mmdb']
  return { provider: inferProvider(source || '', type) }
}
export function searchGeoCatalog(items: string[], query: string) {
  const q = query.trim().toLowerCase()
  return [...items]
    .sort((a, b) => {
      const rank = (v: string) =>
        !q ? 0 : v.toLowerCase() === q ? 0 : v.toLowerCase().startsWith(q) ? 1 : v.toLowerCase().includes(q) ? 2 : 3
      return rank(a) - rank(b) || a.localeCompare(b)
    })
    .filter((v) => !q || v.toLowerCase().includes(q))
    .slice(0, 50)
}
const countryNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' })
export function geoLabel(value: string, type: GeoCatalogType) {
  if (type === 'geoip' && /^[A-Z]{2}$/.test(value)) return `${value} · ${countryNames.of(value) || value}`
  return value
}
