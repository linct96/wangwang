import { asc, eq, inArray } from 'drizzle-orm'
import { profileSubscriptionSources, sources } from './db'
import { db } from './tasks'
import { assertRemoteUrl } from './security'
import type { ProfileSlotBindingInput } from './profile-slot-bindings'
import { slotProviderName, type TemplateSourceSlot } from './templates/source-slots'
import { sourceProviderName } from '../shared/source-slots'

export type ProfileProxyProviders = Record<
  string,
  {
    type: 'http'
    url: string
    path: string
    interval: number
    header: { 'User-Agent': string[] }
    'exclude-filter'?: string
    'health-check': { enable: boolean; url: string; interval: number }
  }
>

export function subscriptionSlotBinding(slot: TemplateSourceSlot, bindings: ProfileSlotBindingInput[]) {
  const binding = bindings.find(({ slotKey }) => slotKey === slot.key)
  if (!binding || binding.mode !== 'source' || binding.sourceIds.length !== 1)
    throw new Error(`订阅源槽位“${slot.name}”必须绑定一个订阅节点源`)
  if (binding.includeRegex || binding.excludeRegex) throw new Error(`订阅源槽位“${slot.name}”不支持槽位级节点过滤`)
  return binding
}

export async function resolveProfileProxyProviders(
  env: Env,
  slots: TemplateSourceSlot[],
  bindings: ProfileSlotBindingInput[],
  subscriptionSourceIds: string[] = [],
): Promise<ProfileProxyProviders> {
  const subscriptions = slots.filter(({ type }) => type === 'subscription')
  const selected = subscriptions.map((slot) => ({
    name: slotProviderName(slot.key),
    subject: `订阅源槽位“${slot.name}”`,
    sourceId: subscriptionSlotBinding(slot, bindings).sourceIds[0],
  }))
  const sourceIds = [...new Set(subscriptionSourceIds)]
  if (sourceIds.length > 20) throw new Error('全部订阅源最多选择 20 个订阅节点源')
  const slotSourceIds = new Set(selected.map(({ sourceId }) => sourceId))
  // 与槽位重复选择时复用已有 provider，避免客户端重复拉取同一订阅。
  selected.push(
    ...sourceIds
      .filter((sourceId) => !slotSourceIds.has(sourceId))
      .map((sourceId) => ({ name: sourceProviderName(sourceId), subject: '全部订阅源', sourceId })),
  )
  if (!selected.length) return {}
  const rows = await db(env)
    .select()
    .from(sources)
    .where(inArray(sources.id, [...new Set(selected.map(({ sourceId }) => sourceId))]))
  const byId = new Map(rows.map((source) => [source.id, source]))
  return Object.fromEntries(
    selected.map(({ name, subject, sourceId }) => {
      const source = byId.get(sourceId)
      if (!source) throw new Error(`${subject}的节点源不存在，请重新绑定`)
      if (!source.enabled) throw new Error(`${subject}的节点源已停用，请重新绑定`)
      if (source.kind !== 'url' || !source.url) throw new Error(`${subject}仅支持有订阅 URL 的节点源`)
      return [
        name,
        {
          type: 'http' as const,
          url: assertRemoteUrl(source.url).href,
          path: `./proxy_providers/${name}.yaml`,
          interval: source.refreshIntervalHours * 3600,
          header: { 'User-Agent': [source.userAgent] },
          ...(source.nodeNameFilter ? { 'exclude-filter': source.nodeNameFilter } : {}),
          'health-check': { enable: true, url: 'https://www.gstatic.com/generate_204', interval: 300 },
        },
      ]
    }),
  )
}

export async function readProfileSubscriptionSources(env: Env, profileId: string) {
  const rows = await db(env)
    .select({ sourceId: profileSubscriptionSources.sourceId })
    .from(profileSubscriptionSources)
    .where(eq(profileSubscriptionSources.profileId, profileId))
    .orderBy(asc(profileSubscriptionSources.position))
  return rows.map(({ sourceId }) => sourceId)
}

export async function replaceProfileSubscriptionSources(env: Env, profileId: string, sourceIds: string[]) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM profile_subscription_sources WHERE profile_id = ?').bind(profileId),
    ...sourceIds.map((sourceId, position) =>
      env.DB.prepare(
        'INSERT INTO profile_subscription_sources (profile_id, source_id, position) VALUES (?, ?, ?)',
      ).bind(profileId, sourceId, position),
    ),
  ])
}
