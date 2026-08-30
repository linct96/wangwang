import dayjs from 'dayjs'
import type { Job, ManualNodeConnection, NodeItem, Profile, Source, TemplateDetail, TemplateId } from '@/api/types'
import type { ProxyConfig } from '../../worker/db'
import { builtinTemplates } from '../../worker/templates/builtin'
import { renderMihomoConfig } from '../../worker/templates/renderer'

export type LocalNode = NodeItem & { sourceIds: string[]; connection?: ManualNodeConnection }
export type LocalState = {
  version: 3
  sources: Source[]
  nodes: LocalNode[]
  profiles: Profile[]
  templates: TemplateDetail[]
  jobs: Job[]
}

const storageKey = 'wangwang:dev:v1'
export function now() {
  return dayjs().toISOString()
}

function seedState(): LocalState {
  const updatedAt = now()
  const sources: Source[] = [
    {
      id: 'source-main',
      name: '主力订阅',
      kind: 'url',
      url: 'https://example.com/sub?token=demo',
      nodeNameFilter: null,
      nodeTag: null,
      userAgent: 'mihomo',
      pendingUrl: false,
      profileCount: 1,
      refreshIntervalHours: 6,
      enabled: true,
      status: 'ready',
      warning: null,
      error: null,
      nodeCount: 6,
      uploadBytes: null,
      downloadBytes: null,
      totalBytes: null,
      expireAt: null,
      infoRefreshedAt: null,
      lastRefreshedAt: updatedAt,
    },
    {
      id: 'system-manual',
      name: '手动节点',
      kind: 'manual',
      url: null,
      nodeNameFilter: null,
      nodeTag: null,
      userAgent: 'mihomo',
      pendingUrl: false,
      profileCount: 0,
      refreshIntervalHours: 0,
      enabled: true,
      status: 'ready',
      warning: null,
      error: null,
      nodeCount: 2,
      uploadBytes: null,
      downloadBytes: null,
      totalBytes: null,
      expireAt: null,
      infoRefreshedAt: null,
      lastRefreshedAt: updatedAt,
    },
    {
      id: 'source-test',
      name: '测试订阅（含流量信息）',
      kind: 'url',
      url: 'https://example.com/test-sub?token=demo',
      nodeNameFilter: null,
      nodeTag: null,
      userAgent: 'Clash.Meta',
      pendingUrl: false,
      profileCount: 0,
      refreshIntervalHours: 6,
      enabled: true,
      status: 'ready',
      warning: null,
      error: null,
      nodeCount: 2,
      uploadBytes: 1_610_612_736,
      downloadBytes: 8_589_934_592,
      totalBytes: 107_374_182_400,
      expireAt: dayjs().add(30, 'day').unix(),
      infoRefreshedAt: updatedAt,
      lastRefreshedAt: updatedAt,
    },
  ]
  const nodeRows = [
    ['香港 01', 'vless', 'hk-01.example.com', 443, ['香港', '高速'], 'source-main'],
    ['香港 02', 'vmess', 'hk-02.example.com', 443, ['香港'], 'source-main'],
    ['日本 01', 'trojan', 'jp-01.example.com', 443, ['日本', '流媒体'], 'source-main'],
    ['新加坡 01', 'hysteria2', 'sg-01.example.com', 8443, ['新加坡', '低延迟'], 'source-main'],
    ['美国 01', 'tuic', 'us-01.example.com', 443, ['美国'], 'source-main'],
    ['台湾 01', 'ss', 'tw-01.example.com', 8388, ['台湾'], 'source-main'],
    ['测试节点 01', 'vless', 'test-01.example.com', 443, ['测试'], 'source-test'],
    ['测试节点 02', 'trojan', 'test-02.example.com', 443, ['测试'], 'source-test'],
    ['备用 01', 'vless', 'backup-01.example.com', 443, ['备用'], 'system-manual'],
    ['备用 02', 'trojan', 'backup-02.example.com', 443, ['备用'], 'system-manual'],
  ] as const
  const nodes: LocalNode[] = nodeRows.map(([name, protocol, server, port, tags, sourceId], index) => ({
    id: `node-${index + 1}`,
    name,
    alias: null,
    protocol,
    server,
    port,
    tags: [...tags],
    enabled: true,
    updatedAt,
    sourceIds: [sourceId],
    management: sourceId === 'system-manual' ? 'manual' : 'subscription',
    canEditConnection: sourceId === 'system-manual',
    canDelete: sourceId === 'system-manual',
    connection:
      sourceId === 'system-manual'
        ? {
            name,
            protocol,
            server,
            port,
            network: 'tcp',
            security: protocol === 'vless' || protocol === 'trojan' ? 'tls' : 'none',
            uuid: protocol === 'vless' ? '' : undefined,
            hasUuid: protocol === 'vless',
            password: protocol === 'trojan' ? '' : undefined,
            hasPassword: protocol === 'trojan',
          }
        : undefined,
  }))
  const profiles: Profile[] = [
    {
      id: 'profile-daily',
      name: '日常使用',
      enabled: true,
      protocols: [],
      tags: [],
      templateId: 'builtin:minimal',
      revision: 3,
      compiledYaml: compileYaml(
        'builtin:minimal',
        nodes.filter((node) => node.sourceIds.includes('source-main')),
        [],
      ),
      compiledAt: updatedAt,
      error: null,
      sourceIds: ['source-main'],
      excludedNodeIds: [],
      subscriptionUrl: '/s/local-token/config.yaml',
    },
  ]
  const jobs: Job[] = [createJob('compile_profile', 'profile-daily', updatedAt)]
  return { version: 3, sources, nodes, profiles, templates: [], jobs }
}

export function readState() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || 'null') as Partial<LocalState> | null
    if (
      value?.version === 3 &&
      Array.isArray(value.sources) &&
      Array.isArray(value.nodes) &&
      Array.isArray(value.profiles) &&
      Array.isArray(value.templates) &&
      Array.isArray(value.jobs)
    ) {
      return value as LocalState
    }
  } catch {
    // 损坏的本地数据直接重置为演示数据。
  }
  const state = seedState()
  writeState(state)
  return state
}

export function writeState(state: LocalState) {
  localStorage.setItem(storageKey, JSON.stringify(state))
}

export function createJob(type: Job['type'], entityId: string, createdAt = now()): Job {
  return { id: crypto.randomUUID(), type, entityId, status: 'succeeded', error: null, createdAt }
}

export function localNodeTags(state: LocalState, node: LocalNode) {
  return [
    ...new Set([
      ...node.tags,
      ...state.sources
        .filter((source) => source.enabled && node.sourceIds.includes(source.id))
        .map((source) => source.nodeTag)
        .filter((tag): tag is string => Boolean(tag)),
    ]),
  ]
}

export function localProfileNodes(
  state: LocalState,
  profile: Pick<Profile, 'sourceIds' | 'protocols' | 'tags' | 'excludedNodeIds'>,
) {
  const enabledSources = new Set(state.sources.filter((source) => source.enabled).map((source) => source.id))
  return state.nodes
    .filter((node) => node.enabled)
    .filter((node) => node.sourceIds.some((id) => profile.sourceIds.includes(id) && enabledSources.has(id)))
    .map((node) => ({ ...node, tags: localNodeTags(state, node) }))
    .filter((node) => !profile.protocols.length || profile.protocols.includes(node.protocol))
    .filter((node) => !profile.tags.length || profile.tags.some((tag) => node.tags.includes(tag)))
    .filter((node) => !profile.excludedNodeIds.includes(node.id))
}

export function recompileProfiles(state: LocalState, sourceIds: string[], profileIds?: string[]) {
  for (const profile of state.profiles.filter((item) =>
    profileIds ? profileIds.includes(item.id) : item.sourceIds.some((id) => sourceIds.includes(id)),
  )) {
    try {
      const available = localProfileNodes(state, profile)
      const compiledYaml = compileYaml(profile.templateId, available, state.templates)
      profile.revision += 1
      profile.compiledAt = now()
      profile.compiledYaml = compiledYaml
      profile.error = null
    } catch (error) {
      profile.error = error instanceof Error ? error.message : '配置编译失败'
    }
    state.jobs.unshift(createJob('compile_profile', profile.id))
  }
}

export function updateProfileCounts(state: LocalState) {
  for (const source of state.sources)
    source.profileCount = state.profiles.filter((profile) => profile.sourceIds.includes(source.id)).length
}

export function localTemplate(templates: TemplateDetail[], id: string) {
  const builtin = builtinTemplates.find((template) => template.id === id)
  if (builtin)
    return {
      ...builtin,
      kind: 'builtin',
      readOnly: true,
      profileCount: 0,
      createdAt: null,
      updatedAt: null,
    } satisfies TemplateDetail
  return templates.find((template) => template.id === id)
}

export function compileYaml(templateId: TemplateId, nodes: NodeItem[], templates: TemplateDetail[]) {
  const template = localTemplate(templates, templateId)
  if (!template) throw new Error('订阅模板不存在')
  return renderMihomoConfig({
    template,
    nodes: nodes.map((node) => ({
      name: node.alias || node.name,
      config: {
        name: node.alias || node.name,
        type: node.protocol,
        server: node.server,
        port: node.port,
      } as ProxyConfig,
    })),
  })
}
