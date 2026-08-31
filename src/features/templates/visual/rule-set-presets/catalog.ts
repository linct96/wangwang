import type { StructuredRuleProviderDraft } from '../model'
import type { RuleSetPreset, RuleSetPresetCategory, RuleSetPresetSource } from './types'

const META_BASE = 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo'

export function ruleSetPresetKey(
  name: string,
  source: RuleSetPresetSource,
  behavior: StructuredRuleProviderDraft['behavior'],
  format: NonNullable<StructuredRuleProviderDraft['format']>,
) {
  return `${name}-${source}-${behavior}-${format}`
}

export function ruleProviderPresetKey(provider: StructuredRuleProviderDraft) {
  if (provider.type !== 'http' || !provider.url || !provider.format) return
  try {
    const url = new URL(provider.url.replace('https://gh-proxy.com/', ''))
    if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com' || url.port) return

    const meta = url.pathname.match(/^\/MetaCubeX\/meta-rules-dat\/meta\/geo\/(geosite|geoip)\/([^/]+)\.mrs$/)
    if (meta) {
      const behavior = meta[1] === 'geosite' ? 'domain' : 'ipcidr'
      if (provider.behavior !== behavior || provider.format !== 'mrs') return
      const name = decodeURIComponent(meta[2])
      return name && !name.includes('/') ? ruleSetPresetKey(name, 'metacubex', behavior, 'mrs') : undefined
    }

    const loyal = url.pathname.match(/^\/Loyalsoldier\/clash-rules\/release\/([^/]+)\.txt$/)
    if (!loyal || provider.format !== 'yaml') return
    const name = decodeURIComponent(loyal[1])
    if (!name || name.includes('/')) return
    const behavior = ['telegramcidr', 'cncidr', 'lancidr'].includes(name)
      ? 'ipcidr'
      : name === 'applications'
        ? 'classical'
        : 'domain'
    if (provider.behavior !== behavior) return
    return ruleSetPresetKey(name, 'loyalsoldier', behavior, 'yaml')
  } catch {
    return
  }
}

function meta(
  id: string,
  name: string,
  category: RuleSetPresetCategory,
  file = id,
  options: Pick<RuleSetPreset, 'defaultTarget' | 'noResolve' | 'keywords'> = {},
  behavior: 'domain' | 'ipcidr' = 'domain',
): RuleSetPreset {
  const scope = behavior === 'ipcidr' ? 'geoip' : 'geosite'
  return {
    id: ruleSetPresetKey(file, 'metacubex', behavior, 'mrs'),
    name,
    category,
    source: 'metacubex',
    description: behavior === 'ipcidr' ? 'IP-CIDR · MRS' : 'Domain · MRS',
    provider: {
      name: id,
      type: 'http',
      behavior,
      format: 'mrs',
      url: `${META_BASE}/${scope}/${file}.mrs`,
      path: `./ruleset/${id}.mrs`,
      interval: 86400,
    },
    ...options,
  }
}

function loyal(id: string, name: string, defaultTarget: 'DIRECT' | 'REJECT'): RuleSetPreset {
  return {
    id: ruleSetPresetKey(id, 'loyalsoldier', 'domain', 'yaml'),
    name,
    category: 'common',
    source: 'loyalsoldier',
    description: 'Domain · YAML',
    defaultTarget,
    provider: {
      name: id,
      type: 'http',
      behavior: 'domain',
      format: 'yaml',
      url: `https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/${id}.txt`,
      path: `./ruleset/${id}.yaml`,
      interval: 86400,
    },
  }
}

export const RULE_SET_PRESETS: RuleSetPreset[] = [
  meta('private', 'Private', 'common', 'private', { defaultTarget: 'DIRECT', keywords: ['私有', '局域网'] }),
  meta('cn', 'CN', 'china', 'cn', { defaultTarget: 'DIRECT', keywords: ['中国', '国内'] }),
  meta(
    'cn-ip',
    'CN IP',
    'china',
    'cn',
    { defaultTarget: 'DIRECT', noResolve: true, keywords: ['中国 IP', '国内 IP'] },
    'ipcidr',
  ),
  meta('proxy', 'Proxy', 'common', 'proxy', { keywords: ['代理'] }),
  loyal('direct', 'Direct', 'DIRECT'),
  loyal('reject', 'Reject', 'REJECT'),
  meta('openai', 'OpenAI', 'ai', 'openai', { keywords: ['ChatGPT'] }),
  meta('claude', 'Claude', 'ai', 'anthropic', { keywords: ['Anthropic'] }),
  meta('gemini', 'Gemini', 'ai', 'google-gemini', { keywords: ['Google AI'] }),
  meta('github', 'GitHub', 'development'),
  meta('google', 'Google', 'development'),
  meta('microsoft', 'Microsoft', 'development'),
  meta('apple', 'Apple', 'development'),
  meta('onedrive', 'OneDrive', 'development'),
  meta('telegram', 'Telegram', 'social', 'telegram', { keywords: ['TG'] }),
  meta('twitter', 'Twitter/X', 'social', 'twitter', { keywords: ['X'] }),
  meta('facebook', 'Facebook', 'social'),
  meta('instagram', 'Instagram', 'social'),
  meta('youtube', 'YouTube', 'media'),
  meta('netflix', 'Netflix', 'media'),
  meta('spotify', 'Spotify', 'media'),
  meta('tiktok', 'TikTok', 'media'),
  meta('bilibili', 'Bilibili', 'media', 'bilibili', { defaultTarget: 'DIRECT', keywords: ['哔哩哔哩'] }),
  meta('bahamut', 'Bahamut', 'media', 'bahamut', { keywords: ['巴哈姆特'] }),
  meta('category-ads-all', 'category-ads-all', 'ads', 'category-ads-all', {
    defaultTarget: 'REJECT',
    keywords: ['广告', '拦截'],
  }),
]
