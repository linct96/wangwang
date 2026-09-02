import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { parsePreferredEndpoint } from '../shared/preferred-node'
import { db } from './tasks'
import { sourceNodes, sources } from './db'
import type { ProxyConfig } from './db'

export const MANUAL_SOURCE_ID = 'system-manual'

const connectionCommon = {
  name: z.string().trim().min(1).max(80),
  server: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
}
const transportFields = {
  network: z.enum(['tcp', 'ws', 'grpc']).default('tcp'),
  wsPath: z.string().max(2048).default('/'),
  wsHost: z.string().trim().max(255).optional(),
  grpcServiceName: z.string().max(255).optional(),
}
const tlsFields = {
  security: z.enum(['none', 'tls', 'reality']).default('none'),
  sni: z.string().trim().max(255).optional(),
  clientFingerprint: z.string().trim().max(60).optional(),
  realityPublicKey: z.string().trim().max(255).optional(),
  realityShortId: z.string().trim().max(255).optional(),
}
export const manualConnectionSchema = z.discriminatedUnion('protocol', [
  z.object({
    ...connectionCommon,
    protocol: z.literal('ss'),
    cipher: z.string().trim().min(1).max(80),
    password: z.string().max(1024).optional(),
    plugin: z.string().trim().max(80).optional(),
    pluginOptions: z.record(z.string(), z.string()).default({}),
  }),
  z.object({
    ...connectionCommon,
    ...transportFields,
    protocol: z.literal('vmess'),
    uuid: z.string().trim().max(255).optional(),
    alterId: z.number().int().min(0).max(65535).default(0),
    cipher: z.string().trim().min(1).max(80).default('auto'),
    security: z.enum(['none', 'tls']).default('none'),
    sni: z.string().trim().max(255).optional(),
    clientFingerprint: z.string().trim().max(60).optional(),
  }),
  z.object({
    ...connectionCommon,
    ...transportFields,
    ...tlsFields,
    protocol: z.literal('vless'),
    uuid: z.string().trim().max(255).optional(),
    flow: z.string().trim().max(120).optional(),
  }),
  z.object({
    ...connectionCommon,
    ...transportFields,
    ...tlsFields,
    protocol: z.literal('trojan'),
    password: z.string().max(1024).optional(),
  }),
  z.object({
    ...connectionCommon,
    protocol: z.literal('hysteria2'),
    password: z.string().max(1024).optional(),
    sni: z.string().trim().max(255).optional(),
    skipCertVerify: z.boolean().default(false),
    obfs: z.string().trim().max(80).optional(),
    obfsPassword: z.string().max(1024).optional(),
  }),
  z.object({
    ...connectionCommon,
    protocol: z.literal('tuic'),
    uuid: z.string().trim().max(255).optional(),
    password: z.string().max(1024).optional(),
    sni: z.string().trim().max(255).optional(),
    congestionController: z.string().trim().min(1).max(80).default('bbr'),
    udpRelayMode: z.string().trim().min(1).max(80).default('native'),
    skipCertVerify: z.boolean().default(false),
  }),
])

export const nodeCreateSchema = z.object({
  connection: manualConnectionSchema,
  tags: z.array(z.string().trim().min(1).max(24)).max(10).default([]),
  enabled: z.boolean().default(true),
})
export const nodeImportSchema = z.object({
  content: z
    .string()
    .min(1, '节点内容不能为空')
    .max(1024 * 1024, '节点内容超过 1 MiB'),
  tags: z.array(z.string().trim().min(1).max(24)).max(10).default([]),
  enabled: z.boolean().default(true),
})
const preferredAddressSchema = z
  .string()
  .trim()
  .min(1, '优选地址不能为空')
  .max(340, '单行优选配置不能超过 340 个字符')
  .transform((value, context) => {
    try {
      return parsePreferredEndpoint(value)
    } catch (reason) {
      context.addIssue({ code: 'custom', message: reason instanceof Error ? reason.message : '优选地址无效' })
      return z.NEVER
    }
  })
export const preferredNodeCreateSchema = z
  .object({
    sourceNodeIds: z.array(z.string().min(1).max(64)).min(1, '请至少选择一个节点').max(20, '最多选择 20 个节点'),
    addresses: z.array(preferredAddressSchema).min(1, '请至少填写一个优选地址').max(100, '最多填写 100 个优选地址'),
    tags: z.array(z.string().trim().min(1).max(24)).max(10).default([]),
    enabled: z.boolean().default(true),
  })
  .refine(({ sourceNodeIds, addresses }) => sourceNodeIds.length * addresses.length <= 100, {
    message: '单次最多生成 100 个节点',
  })
export const nodeUpdateSchema = z.object({
  alias: z.string().trim().max(80).nullable().optional(),
  enabled: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(10).optional(),
  connection: manualConnectionSchema.optional(),
  yaml: z
    .string()
    .min(1, 'YAML 内容不能为空')
    .max(1024 * 1024, 'YAML 内容超过 1 MiB')
    .optional(),
})
export const nodeBatchSchema = z.object({ ids: z.array(z.string()).min(1).max(100), enabled: z.boolean() })
export const nodeDeleteBatchSchema = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(100) })

export type ManualConnection = z.infer<typeof manualConnectionSchema>

function requiredSecret(value: string | undefined, current: unknown, label: string) {
  const result = value || (typeof current === 'string' ? current : '')
  if (!result) throw new Error(`${label}不能为空`)
  return result
}

function applyTransport(input: ManualConnection, config: ProxyConfig) {
  if (!('network' in input) || input.network === 'tcp') return
  config.network = input.network
  if (input.network === 'ws')
    config['ws-opts'] = { path: input.wsPath || '/', headers: input.wsHost ? { Host: input.wsHost } : undefined }
  if (input.network === 'grpc') config['grpc-opts'] = { 'grpc-service-name': input.grpcServiceName || '' }
}

function applyTls(input: ManualConnection, config: ProxyConfig) {
  if (!('security' in input) || input.security === 'none') return
  config.tls = true
  config.servername = input.sni || input.server
  if (input.clientFingerprint) config['client-fingerprint'] = input.clientFingerprint
  if (input.security === 'reality') {
    if (!input.realityPublicKey) throw new Error('Reality 公钥不能为空')
    config['reality-opts'] = { 'public-key': input.realityPublicKey, 'short-id': input.realityShortId || '' }
  }
}

export function buildManualConfig(input: ManualConnection, current?: ProxyConfig): ProxyConfig {
  const config: ProxyConfig = {
    name: input.name,
    type: input.protocol,
    server: input.server,
    port: input.port,
    udp: true,
  }
  if (input.protocol === 'ss') {
    config.cipher = input.cipher
    config.password = requiredSecret(input.password, current?.password, '密码')
    if (input.plugin) {
      config.plugin = input.plugin
      config['plugin-opts'] = input.pluginOptions
    }
  } else if (input.protocol === 'vmess') {
    config.uuid = requiredSecret(input.uuid, current?.uuid, 'UUID')
    config.alterId = input.alterId
    config.cipher = input.cipher
    applyTransport(input, config)
    applyTls(input, config)
  } else if (input.protocol === 'vless') {
    config.uuid = requiredSecret(input.uuid, current?.uuid, 'UUID')
    if (input.flow) config.flow = input.flow
    applyTransport(input, config)
    applyTls(input, config)
  } else if (input.protocol === 'trojan') {
    config.password = requiredSecret(input.password, current?.password, '密码')
    applyTransport(input, config)
    applyTls(input, config)
  } else if (input.protocol === 'hysteria2') {
    config.password = requiredSecret(input.password, current?.password, '密码')
    config.sni = input.sni || input.server
    config['skip-cert-verify'] = input.skipCertVerify
    if (input.obfs) config.obfs = input.obfs
    if (input.obfsPassword || current?.['obfs-password'])
      config['obfs-password'] = input.obfsPassword || current?.['obfs-password']
  } else {
    config.uuid = requiredSecret(input.uuid, current?.uuid, 'UUID')
    config.password = requiredSecret(input.password, current?.password, '密码')
    config.sni = input.sni || input.server
    config['congestion-controller'] = input.congestionController
    config['udp-relay-mode'] = input.udpRelayMode
    config['skip-cert-verify'] = input.skipCertVerify
  }
  return config
}

export function connectionView(config: ProxyConfig) {
  if (
    Object.hasOwn(config, 'ech-opts') ||
    Object.hasOwn(config, 'encryption') ||
    (Object.hasOwn(config, 'client-fingerprint') && !['vmess', 'vless', 'trojan'].includes(config.type))
  )
    return null

  const common = { name: config.name, protocol: config.type, server: config.server, port: config.port }
  const network = String(config.network || 'tcp') as 'tcp' | 'ws' | 'grpc'
  const ws = (config['ws-opts'] || {}) as { path?: string; headers?: { Host?: string } }
  const grpc = (config['grpc-opts'] || {}) as { 'grpc-service-name'?: string }
  const reality = (config['reality-opts'] || {}) as { 'public-key'?: string; 'short-id'?: string }
  const transport = {
    network,
    wsPath: ws.path || '/',
    wsHost: ws.headers?.Host || '',
    grpcServiceName: grpc['grpc-service-name'] || '',
  }
  const tls = {
    security: reality['public-key'] ? ('reality' as const) : config.tls ? ('tls' as const) : ('none' as const),
    sni: String(config.servername || config.sni || ''),
    clientFingerprint: String(config['client-fingerprint'] || ''),
    realityPublicKey: reality['public-key'] || '',
    realityShortId: reality['short-id'] || '',
  }
  if (config.type === 'ss')
    return {
      ...common,
      cipher: String(config.cipher || ''),
      password: String(config.password || ''),
      hasPassword: Boolean(config.password),
      plugin: String(config.plugin || ''),
      pluginOptions: (config['plugin-opts'] || {}) as Record<string, string>,
    }
  if (config.type === 'vmess')
    return {
      ...common,
      ...transport,
      ...tls,
      uuid: String(config.uuid || ''),
      hasUuid: Boolean(config.uuid),
      alterId: Number(config.alterId || 0),
      cipher: String(config.cipher || 'auto'),
    }
  if (config.type === 'vless')
    return {
      ...common,
      ...transport,
      ...tls,
      uuid: String(config.uuid || ''),
      hasUuid: Boolean(config.uuid),
      flow: String(config.flow || ''),
    }
  if (config.type === 'trojan')
    return {
      ...common,
      ...transport,
      ...tls,
      password: String(config.password || ''),
      hasPassword: Boolean(config.password),
    }
  if (config.type === 'hysteria2')
    return {
      ...common,
      password: String(config.password || ''),
      hasPassword: Boolean(config.password),
      sni: String(config.sni || ''),
      skipCertVerify: Boolean(config['skip-cert-verify']),
      obfs: String(config.obfs || ''),
      obfsPassword: String(config['obfs-password'] || ''),
      hasObfsPassword: Boolean(config['obfs-password']),
    }
  return {
    ...common,
    uuid: String(config.uuid || ''),
    hasUuid: Boolean(config.uuid),
    password: String(config.password || ''),
    hasPassword: Boolean(config.password),
    sni: String(config.sni || ''),
    congestionController: String(config['congestion-controller'] || 'bbr'),
    udpRelayMode: String(config['udp-relay-mode'] || 'native'),
    skipCertVerify: Boolean(config['skip-cert-verify']),
  }
}

export function management(kinds: Array<'url' | 'manual'>) {
  const manual = kinds.includes('manual')
  const subscription = kinds.includes('url')
  return manual && subscription ? 'mixed' : manual ? 'manual' : 'subscription'
}

export async function nodeKinds(env: Env, nodeIds: string[]) {
  const result = new Map<string, Array<'url' | 'manual'>>()
  if (!nodeIds.length) return result
  const rows = await db(env)
    .select({ nodeId: sourceNodes.nodeId, kind: sources.kind })
    .from(sourceNodes)
    .innerJoin(sources, eq(sources.id, sourceNodes.sourceId))
    .where(and(inArray(sourceNodes.nodeId, nodeIds), eq(sources.enabled, true)))
  for (const row of rows) result.set(row.nodeId, [...(result.get(row.nodeId) || []), row.kind])
  return result
}

export async function nodeSourceTags(env: Env, nodeIds: string[]) {
  const result = new Map<string, string[]>()
  if (!nodeIds.length) return result
  const rows = await db(env)
    .select({ nodeId: sourceNodes.nodeId, tag: sources.nodeTag })
    .from(sourceNodes)
    .innerJoin(sources, eq(sources.id, sourceNodes.sourceId))
    .where(and(inArray(sourceNodes.nodeId, nodeIds), eq(sources.enabled, true)))
  for (const row of rows) if (row.tag) result.set(row.nodeId, [...(result.get(row.nodeId) || []), row.tag])
  return result
}
