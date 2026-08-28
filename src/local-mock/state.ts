import dayjs from 'dayjs'
import type { Job, ManualNodeConnection, NodeItem, Profile, Source } from '@/api/types'

export type LocalNode = NodeItem & { sourceIds: string[]; connection?: ManualNodeConnection }
export type LocalState = {
  version: 2
  sources: Source[]
  nodes: LocalNode[]
  profiles: Profile[]
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
      url: 'https://example.com/sub?***',
      nodeNameFilter: null,
      nodeTag: null,
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
      url: 'https://example.com/test-sub?***',
      nodeNameFilter: null,
      nodeTag: null,
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
      ruleModules: ['ads', 'private', 'cn'],
      dnsMode: 'fake-ip',
      revision: 3,
      compiledYaml: compileYaml('日常使用', nodes),
      compiledAt: updatedAt,
      error: null,
      sourceIds: ['source-main'],
      excludedNodeIds: [],
      subscriptionUrl: '/s/profile-daily/local-token/config.yaml',
    },
  ]
  const jobs: Job[] = [createJob('compile_profile', 'profile-daily', updatedAt)]
  return { version: 2, sources, nodes, profiles, jobs }
}

export function readState() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || 'null') as {
      version?: number
      sources?: Source[]
      nodes?: LocalNode[]
      profiles?: Profile[]
      jobs?: Job[]
    } | null
    if (
      (value?.version === 1 || value?.version === 2) &&
      Array.isArray(value.sources) &&
      Array.isArray(value.nodes) &&
      Array.isArray(value.profiles) &&
      Array.isArray(value.jobs)
    ) {
      if (value.version === 2) return value as LocalState
      const manualIds = new Set(value.sources.filter((source) => source.kind === 'manual').map((source) => source.id))
      const rewriteSources = (ids: string[]) => [
        ...new Set(ids.map((id) => (manualIds.has(id) ? 'system-manual' : id))),
      ]
      const nodes = (value.nodes as LocalNode[]).map((node) => {
        const sourceIds = rewriteSources(node.sourceIds)
        const hasManual = sourceIds.includes('system-manual')
        const hasSubscription = sourceIds.some((id) => id !== 'system-manual')
        const nodeManagement: NodeItem['management'] =
          hasManual && hasSubscription ? 'mixed' : hasManual ? 'manual' : 'subscription'
        return {
          ...node,
          sourceIds,
          management: nodeManagement,
          canEditConnection: nodeManagement === 'manual',
          canDelete: hasManual,
          connection: hasManual
            ? {
                name: node.name,
                protocol: node.protocol as ManualNodeConnection['protocol'],
                server: node.server,
                port: node.port,
                network: 'tcp' as const,
                security: 'none' as const,
              }
            : undefined,
        }
      })
      const sources = [
        ...value.sources
          .filter((source) => source.kind === 'url')
          .map((source) => ({ ...source, pendingUrl: false, profileCount: 0 })),
        {
          id: 'system-manual',
          name: '手动节点',
          kind: 'manual' as const,
          url: null,
          nodeNameFilter: null,
          nodeTag: null,
          pendingUrl: false,
          profileCount: 0,
          refreshIntervalHours: 0,
          enabled: true,
          status: 'ready' as const,
          warning: null,
          error: null,
          nodeCount: nodes.filter((node) => node.sourceIds.includes('system-manual')).length,
          uploadBytes: null,
          downloadBytes: null,
          totalBytes: null,
          expireAt: null,
          infoRefreshedAt: null,
          lastRefreshedAt: null,
        },
      ]
      const profiles = value.profiles.map((profile) => ({ ...profile, sourceIds: rewriteSources(profile.sourceIds) }))
      for (const source of sources)
        source.profileCount = profiles.filter((profile) => profile.sourceIds.includes(source.id)).length
      const migrated: LocalState = { version: 2, sources, nodes, profiles, jobs: value.jobs }
      writeState(migrated)
      return migrated
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

export function displayUrl(value: string) {
  const url = new URL(value)
  return `${url.origin}${url.pathname}${url.search ? '?***' : ''}`
}

export function localNodeTags(state: LocalState, node: LocalNode) {
  return [
    ...new Set([
      ...node.tags,
      ...state.sources
        .filter((source) => node.sourceIds.includes(source.id))
        .map((source) => source.nodeTag)
        .filter((tag): tag is string => Boolean(tag)),
    ]),
  ]
}

export function recompileProfiles(state: LocalState, sourceIds: string[], profileIds?: string[]) {
  const enabledSources = new Set(state.sources.filter((source) => source.enabled).map((source) => source.id))
  for (const profile of state.profiles.filter((item) =>
    profileIds ? profileIds.includes(item.id) : item.sourceIds.some((id) => sourceIds.includes(id)),
  )) {
    const available = state.nodes
      .filter((node) => node.sourceIds.some((id) => profile.sourceIds.includes(id) && enabledSources.has(id)))
      .map((node) => ({ ...node, tags: localNodeTags(state, node) }))
      .filter((node) => !profile.tags.length || profile.tags.some((tag) => node.tags.includes(tag)))
    if (available.length) {
      profile.revision += 1
      profile.compiledAt = now()
      profile.compiledYaml = compileYaml(profile.name, available)
      profile.error = null
    } else profile.error = '配置没有可用节点'
    state.jobs.unshift(createJob('compile_profile', profile.id))
  }
}

export function updateProfileCounts(state: LocalState) {
  for (const source of state.sources)
    source.profileCount = state.profiles.filter((profile) => profile.sourceIds.includes(source.id)).length
}

export function compileYaml(name: string, nodes: NodeItem[]) {
  const proxies = nodes
    .slice(0, 4)
    .map(
      (node) =>
        `  - name: ${node.alias || node.name}\n    type: ${node.protocol}\n    server: ${node.server}\n    port: ${node.port}`,
    )
  return `# ${name}\nmode: rule\nproxies:\n${proxies.join('\n')}\nrules:\n  - GEOIP,CN,DIRECT\n  - MATCH,PROXY\n`
}
