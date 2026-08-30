import type { GeoSettingsDraft } from '../model'

export type GeoPresetType = 'metacubex-full' | 'metacubex-lite' | 'loyalsoldier' | 'default' | 'custom'

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

export function createRecommendedGeoSettings(): GeoSettingsDraft {
  return { ...METACUBEX_FULL_GEO_PRESET, geoxUrl: { ...METACUBEX_FULL_GEO_PRESET.geoxUrl } }
}

export function createLiteGeoSettings(): GeoSettingsDraft {
  return { ...METACUBEX_LITE_GEO_PRESET, geoxUrl: { ...METACUBEX_LITE_GEO_PRESET.geoxUrl } }
}

export function createLoyalsoldierGeoSettings(): GeoSettingsDraft {
  return { ...LOYALSOLDIER_GEO_PRESET, geoxUrl: { ...LOYALSOLDIER_GEO_PRESET.geoxUrl } }
}

export function createEmptyGeoSettings(): GeoSettingsDraft {
  return { ...EMPTY_GEO_PRESET, geoxUrl: { ...EMPTY_GEO_PRESET.geoxUrl } }
}

function matchUrl(actual?: string | null, target?: string | null) {
  return (actual || null) === (target || null)
}

export function detectActivePreset(geo: GeoSettingsDraft): GeoPresetType {
  const isDefault =
    geo.geodataMode == null &&
    geo.geoAutoUpdate == null &&
    geo.geoUpdateInterval == null &&
    !Object.values(geo.geoxUrl).some(Boolean)

  if (isDefault) return 'default'

  const matchFull =
    geo.geodataMode === METACUBEX_FULL_GEO_PRESET.geodataMode &&
    matchUrl(geo.geoxUrl.geoip, METACUBEX_FULL_GEO_PRESET.geoxUrl.geoip) &&
    matchUrl(geo.geoxUrl.geosite, METACUBEX_FULL_GEO_PRESET.geoxUrl.geosite) &&
    matchUrl(geo.geoxUrl.mmdb, METACUBEX_FULL_GEO_PRESET.geoxUrl.mmdb) &&
    matchUrl(geo.geoxUrl.asn, METACUBEX_FULL_GEO_PRESET.geoxUrl.asn)

  if (matchFull) return 'metacubex-full'

  const matchLite =
    geo.geodataMode === METACUBEX_LITE_GEO_PRESET.geodataMode &&
    matchUrl(geo.geoxUrl.geoip, METACUBEX_LITE_GEO_PRESET.geoxUrl.geoip) &&
    matchUrl(geo.geoxUrl.geosite, METACUBEX_LITE_GEO_PRESET.geoxUrl.geosite) &&
    matchUrl(geo.geoxUrl.mmdb, METACUBEX_LITE_GEO_PRESET.geoxUrl.mmdb) &&
    matchUrl(geo.geoxUrl.asn, METACUBEX_LITE_GEO_PRESET.geoxUrl.asn)

  if (matchLite) return 'metacubex-lite'

  const matchLoyal =
    geo.geodataMode === LOYALSOLDIER_GEO_PRESET.geodataMode &&
    matchUrl(geo.geoxUrl.geoip, LOYALSOLDIER_GEO_PRESET.geoxUrl.geoip) &&
    matchUrl(geo.geoxUrl.geosite, LOYALSOLDIER_GEO_PRESET.geoxUrl.geosite)

  if (matchLoyal) return 'loyalsoldier'

  return 'custom'
}

