import { parse } from 'yaml'
import type { GeoSettingsDraft } from '../model'
export type GeoCatalogType = 'geosite' | 'geoip'
export type GeoDataset = 'full' | 'lite'
export function detectGeoSource(yaml: string, type: 'GEOSITE' | 'GEOIP'): { dataset: GeoDataset; custom: boolean } {
  let config: Record<string, unknown> = {}
  try {
    config = (parse(yaml) || {}) as Record<string, unknown>
  } catch {
    return { dataset: 'full', custom: false }
  }
  const geodataMode = config['geodata-mode'] === true
  const geox = (config['geox-url'] || {}) as Record<string, unknown>
  const source = type === 'GEOSITE' ? String(geox.geosite || '') : String(geox[geodataMode ? 'geoip' : 'mmdb'] || '')
  const lite =
    type === 'GEOSITE' ? /geosite-lite\.dat/i.test(source) : /geoip-lite\.dat|country-lite\.mmdb/i.test(source)
  const known =
    type === 'GEOSITE' ? /geosite(?:-lite)?\.dat/i : geodataMode ? /geoip(?:-lite)?\.dat/i : /country(?:-lite)?\.mmdb/i
  return { dataset: lite ? 'lite' : 'full', custom: Boolean(source) && !known.test(source) }
}
export function detectGeoDataset(yaml: string, type: 'GEOSITE' | 'GEOIP'): GeoDataset {
  return detectGeoSource(yaml, type).dataset
}
export function inferGeoDataset(geo: GeoSettingsDraft, type: 'GEOSITE' | 'GEOIP'): GeoDataset {
  const mode = geo.geodataMode === true
  const source = type === 'GEOSITE' ? geo.geoxUrl.geosite : geo.geoxUrl[mode ? 'geoip' : 'mmdb']
  return source && (type === 'GEOSITE' ? /geosite-lite\.dat/i : /geoip-lite\.dat|country-lite\.mmdb/i).test(source)
    ? 'lite'
    : 'full'
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
