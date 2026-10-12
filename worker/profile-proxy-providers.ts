import { inArray } from 'drizzle-orm'
import { sources } from './db'
import { db } from './tasks'
import { assertRemoteUrl } from './security'
import type { ProfileSlotBindingInput } from './profile-slot-bindings'
import { slotProviderName, type TemplateSourceSlot } from './templates/source-slots'

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
): Promise<ProfileProxyProviders> {
  const subscriptions = slots.filter(({ type }) => type === 'subscription')
  if (!subscriptions.length) return {}
  const selected = subscriptions.map((slot) => ({
    slot,
    sourceId: subscriptionSlotBinding(slot, bindings).sourceIds[0],
  }))
  const rows = await db(env)
    .select()
    .from(sources)
    .where(inArray(sources.id, [...new Set(selected.map(({ sourceId }) => sourceId))]))
  const byId = new Map(rows.map((source) => [source.id, source]))
  return Object.fromEntries(
    selected.map(({ slot, sourceId }) => {
      const source = byId.get(sourceId)
      if (!source) throw new Error(`订阅源槽位“${slot.name}”的节点源不存在，请重新绑定`)
      if (!source.enabled) throw new Error(`订阅源槽位“${slot.name}”的节点源已停用，请重新绑定`)
      if (source.kind !== 'url' || !source.url) throw new Error(`订阅源槽位“${slot.name}”仅支持有订阅 URL 的节点源`)
      const name = slotProviderName(slot.key)
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
