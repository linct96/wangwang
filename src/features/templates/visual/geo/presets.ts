import type { GeoSettingsDraft } from '../model'

export type GeoPresetType =
  | 'metacubex-full'
  | 'metacubex-full-domestic'
  | 'metacubex-lite'
  | 'metacubex-lite-domestic'
  | 'loyalsoldier'
  | 'loyalsoldier-domestic'
  | 'default'
  | 'custom'

export const METACUBEX_FULL_GEO_PRESET: GeoSettingsDraft = {
  geodataMode: true,
  geoAutoUpdate: true,
  geoUpdateInterval: 24,
  geoxUrl: {
    geoip: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat',
    geosite: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat',
    mmdb: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country.mmdb',
    asn: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb',
  },
}

export const METACUBEX_LITE_GEO_PRESET: GeoSettingsDraft = {
  geodataMode: true,
  geoAutoUpdate: true,
  geoUpdateInterval: 24,
  geoxUrl: {
    geoip: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip-lite.dat',
    geosite: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite-lite.dat',
    mmdb: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country-lite.mmdb',
    asn: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb',
  },
}

export const LOYALSOLDIER_GEO_PRESET: GeoSettingsDraft = {
  geodataMode: true,
  geoAutoUpdate: true,
  geoUpdateInterval: 24,
  geoxUrl: {
    geoip: 'https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat',
    geosite: 'https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat',
    mmdb: null,
    asn: null,
  },
}

export const EMPTY_GEO_PRESET: GeoSettingsDraft = {
  geodataMode: null,
  geoAutoUpdate: null,
  geoUpdateInterval: null,
  geoxUrl: {
    geoip: null,
    geosite: null,
    mmdb: null,
    asn: null,
  },
}

const GH_PROXY_PREFIX = 'https://gh-proxy.com/'

function createGhProxyGeoSettings(factory: () => GeoSettingsDraft): GeoSettingsDraft {
  const settings = factory()
  return {
    ...settings,
    geoxUrl: Object.fromEntries(
      Object.entries(settings.geoxUrl).map(([key, url]) => [key, url ? `${GH_PROXY_PREFIX}${url}` : url]),
    ) as GeoSettingsDraft['geoxUrl'],
  }
}

export function createRecommendedGeoSettings(): GeoSettingsDraft {
  return { ...METACUBEX_FULL_GEO_PRESET, geoxUrl: { ...METACUBEX_FULL_GEO_PRESET.geoxUrl } }
}

export function createLiteGeoSettings(): GeoSettingsDraft {
  return { ...METACUBEX_LITE_GEO_PRESET, geoxUrl: { ...METACUBEX_LITE_GEO_PRESET.geoxUrl } }
}

export function createLoyalsoldierGeoSettings(): GeoSettingsDraft {
  return { ...LOYALSOLDIER_GEO_PRESET, geoxUrl: { ...LOYALSOLDIER_GEO_PRESET.geoxUrl } }
}

export function createDomesticRecommendedGeoSettings(): GeoSettingsDraft {
  return createGhProxyGeoSettings(createRecommendedGeoSettings)
}

export function createDomesticLiteGeoSettings(): GeoSettingsDraft {
  return createGhProxyGeoSettings(createLiteGeoSettings)
}

export function createDomesticLoyalsoldierGeoSettings(): GeoSettingsDraft {
  return createGhProxyGeoSettings(createLoyalsoldierGeoSettings)
}

export function createEmptyGeoSettings(): GeoSettingsDraft {
  return { ...EMPTY_GEO_PRESET, geoxUrl: { ...EMPTY_GEO_PRESET.geoxUrl } }
}

function matchUrl(actual?: string | null, target?: string | null) {
  return (actual || null) === (target || null)
}

function matchGeoUrls(
  geo: GeoSettingsDraft,
  preset: GeoSettingsDraft,
  keys: readonly (keyof GeoSettingsDraft['geoxUrl'])[] = ['geoip', 'geosite', 'mmdb', 'asn'],
) {
  return (
    keys.some((key) => Boolean(preset.geoxUrl[key])) &&
    keys.every((key) => matchUrl(geo.geoxUrl[key], preset.geoxUrl[key]))
  )
}

export function detectActivePreset(geo: GeoSettingsDraft): GeoPresetType {
  const isDefault = !Object.values(geo.geoxUrl).some(Boolean)

  if (isDefault) return 'default'

  if (matchGeoUrls(geo, METACUBEX_FULL_GEO_PRESET)) return 'metacubex-full'
  if (matchGeoUrls(geo, createDomesticRecommendedGeoSettings())) return 'metacubex-full-domestic'
  if (matchGeoUrls(geo, METACUBEX_LITE_GEO_PRESET)) return 'metacubex-lite'
  if (matchGeoUrls(geo, createDomesticLiteGeoSettings())) return 'metacubex-lite-domestic'
  if (matchGeoUrls(geo, LOYALSOLDIER_GEO_PRESET, ['geoip', 'geosite'])) return 'loyalsoldier'
  if (matchGeoUrls(geo, createDomesticLoyalsoldierGeoSettings(), ['geoip', 'geosite'])) return 'loyalsoldier-domestic'

  return 'custom'
}
