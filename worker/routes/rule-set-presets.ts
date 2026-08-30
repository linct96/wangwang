import { Hono } from 'hono'
import { ok } from '../http'
import { RULE_SET_PRESETS } from '../../src/features/templates/visual/rule-set-presets/catalog'
import type { RuleSetPreset, RuleSetPresetCategory } from '../../src/features/templates/visual/rule-set-presets/types'

type GitTreeItem = { path?: string; type?: 'blob' | 'tree'; sha?: string }
type GitTree = { sha: string; tree: GitTreeItem[]; truncated?: boolean }
type StoredCatalog = { items: RuleSetPreset[]; updatedAt: string; revision: string }

const CATALOG_KEY = 'rule-set-presets:catalog:v1'
const MAX_AGE = 36 * 60 * 60 * 1000
const META_REPO = 'MetaCubeX/meta-rules-dat'
const LOYAL_REPO = 'Loyalsoldier/clash-rules'

async function githubTree(repo: string, ref: string, token?: string): Promise<GitTree> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'wangwang' }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`https://api.github.com/repos/${repo}/git/trees/${ref}`, { headers })
  if (!response.ok) throw new Error(`GitHub ${repo} ${response.status}`)
  const tree = (await response.json()) as GitTree
  if (tree.truncated) throw new Error(`GitHub ${repo} tree truncated`)
  return tree
}

function childTree(tree: GitTree, path: string) {
  const item = tree.tree.find((entry) => entry.type === 'tree' && entry.path === path)
  if (!item?.sha) throw new Error(`GitHub tree path missing: ${path}`)
  return item.sha
}

function category(name: string): RuleSetPresetCategory {
  if (name.includes('@ads') || name.includes('ads') || name.includes('adblock')) return 'ads'
  if (/openai|anthropic|gemini|xai|ai-/.test(name)) return 'ai'
  if (/youtube|netflix|spotify|tiktok|bilibili|bahamut|disney|hbo/.test(name)) return 'media'
  if (/telegram|twitter|facebook|instagram|whatsapp|discord/.test(name)) return 'social'
  if (/github|gitlab|microsoft|apple|google|onedrive|jetbrains/.test(name)) return 'development'
  if (name === 'cn' || name.endsWith('@cn')) return 'china'
  if (name === 'private' || name === 'proxy' || name === 'direct' || name === 'reject') return 'common'
  return 'service'
}

function metaPreset(name: string, behavior: 'domain' | 'ipcidr'): RuleSetPreset {
  const scope = behavior === 'domain' ? 'geosite' : 'geoip'
  const providerName = behavior === 'domain' ? name : `${name}-ip`
  const defaultTarget = name === 'cn' || name === 'private' ? 'DIRECT' : category(name) === 'ads' ? 'REJECT' : undefined
  return {
    id: `community:metacubex:${scope}:${name}`,
    name: behavior === 'domain' ? name : `${name} IP`,
    source: 'metacubex',
    category: category(name),
    description: behavior === 'domain' ? 'Domain · MRS' : 'IP-CIDR · MRS',
    provider: {
      name: providerName,
      type: 'http',
      behavior,
      format: 'mrs',
      url: `https://raw.githubusercontent.com/${META_REPO}/meta/geo/${scope}/${encodeURIComponent(name)}.mrs`,
      path: `./ruleset/${providerName}.mrs`,
      interval: 86400,
    },
    defaultTarget,
    noResolve: behavior === 'ipcidr' ? true : undefined,
    keywords: [scope],
  }
}

function loyalPreset(name: string): RuleSetPreset {
  const behavior = ['telegramcidr', 'cncidr', 'lancidr'].includes(name)
    ? 'ipcidr'
    : name === 'applications'
      ? 'classical'
      : 'domain'
  return {
    id: `community:loyalsoldier:${name}`,
    name,
    source: 'loyalsoldier',
    category: category(name),
    description: `${behavior === 'ipcidr' ? 'IP-CIDR' : behavior === 'classical' ? 'Classical' : 'Domain'} · YAML`,
    provider: {
      name,
      type: 'http',
      behavior,
      format: 'yaml',
      url: `https://raw.githubusercontent.com/${LOYAL_REPO}/release/${encodeURIComponent(name)}.txt`,
      path: `./ruleset/${name}.yaml`,
      interval: 86400,
    },
    defaultTarget:
      name === 'reject' ? 'REJECT' : ['direct', 'private', 'cncidr', 'lancidr'].includes(name) ? 'DIRECT' : undefined,
    noResolve: behavior === 'ipcidr' ? true : undefined,
  }
}

function files(tree: GitTree, extension: string) {
  return tree.tree.flatMap((item) =>
    item.type === 'blob' && item.path?.endsWith(extension) ? [item.path.slice(0, -extension.length)] : [],
  )
}

function mergeBuiltins(items: RuleSetPreset[]) {
  const builtinUrls = new Set(RULE_SET_PRESETS.map((item) => item.provider.url))
  return [
    ...RULE_SET_PRESETS,
    ...items
      .filter((item) => !builtinUrls.has(item.provider.url))
      .sort((left, right) => left.name.localeCompare(right.name, 'en')),
  ]
}

export async function syncRuleSetPresetCatalog(env: Env): Promise<StoredCatalog> {
  const previous = await env.KV.get<StoredCatalog>(CATALOG_KEY, { type: 'json' })
  const [metaRoot, loyalRoot] = await Promise.all([
    githubTree(META_REPO, 'meta', env.GITHUB_TOKEN),
    githubTree(LOYAL_REPO, 'release', env.GITHUB_TOKEN),
  ])
  const revision = `${metaRoot.sha}:${loyalRoot.sha}`
  if (previous?.revision === revision) {
    const result = { ...previous, updatedAt: new Date().toISOString() }
    await env.KV.put(CATALOG_KEY, JSON.stringify(result))
    return result
  }

  const metaGeo = await githubTree(META_REPO, childTree(metaRoot, 'geo'), env.GITHUB_TOKEN)
  const [geosite, geoip] = await Promise.all([
    githubTree(META_REPO, childTree(metaGeo, 'geosite'), env.GITHUB_TOKEN),
    githubTree(META_REPO, childTree(metaGeo, 'geoip'), env.GITHUB_TOKEN),
  ])
  const items = mergeBuiltins([
    ...files(geosite, '.mrs').map((name) => metaPreset(name, 'domain')),
    ...files(geoip, '.mrs').map((name) => metaPreset(name, 'ipcidr')),
    ...files(loyalRoot, '.txt').map(loyalPreset),
  ])
  const result = { items, revision, updatedAt: new Date().toISOString() }
  await env.KV.put(CATALOG_KEY, JSON.stringify(result))
  return result
}

async function ruleSetPresetCatalog(env: Env) {
  const stored = await env.KV.get<StoredCatalog>(CATALOG_KEY, { type: 'json' })
  if (stored && Date.now() - Date.parse(stored.updatedAt) < MAX_AGE) return { ...stored, stale: false }
  try {
    return { ...(await syncRuleSetPresetCatalog(env)), stale: false }
  } catch {
    if (stored) return { ...stored, stale: true }
    return { items: RULE_SET_PRESETS, updatedAt: null, revision: null, stale: true }
  }
}

export const ruleSetPresetsRouter = new Hono<{ Bindings: Env }>()

ruleSetPresetsRouter.get('/catalog', async (c) => ok(c, await ruleSetPresetCatalog(c.env)))
