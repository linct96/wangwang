import type { GeoSettingsDraft } from '../model'

export const METACUBEX_FULL_GEO_PRESET = {
  geodataMode: true,
  geoAutoUpdate: true,
  geoUpdateInterval: 24,
  geoxUrl: {
    geoip: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat',
    geosite: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat',
    mmdb: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country.mmdb',
    asn: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb',
  },
} satisfies GeoSettingsDraft

export function createRecommendedGeoSettings(): GeoSettingsDraft {
  return { ...METACUBEX_FULL_GEO_PRESET, geoxUrl: { ...METACUBEX_FULL_GEO_PRESET.geoxUrl } }
}
