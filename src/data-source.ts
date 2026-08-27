export type Job = {
  id: string
  type: 'refresh_source' | 'compile_profile'
  entityId: string
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  error: string | null
  createdAt: string
}

export type Source = {
  id: string
  name: string
  kind: 'url' | 'manual'
  url: string | null
  pendingUrl: boolean
  profileCount: number
  refreshIntervalHours: number
  enabled: boolean
  status: 'idle' | 'refreshing' | 'ready' | 'error'
  warning: string | null
  error: string | null
  nodeCount: number
  lastRefreshedAt: string | null
}

export type NodeItem = {
  id: string
  name: string
  alias: string | null
  protocol: string
  server: string
  port: number
  tags: string[]
  enabled: boolean
  updatedAt: string
  management: 'subscription' | 'manual' | 'mixed'
  canEditConnection: boolean
  canDelete: boolean
}

export type ManualNodeConnection = {
  name: string
  protocol: 'ss' | 'vmess' | 'vless' | 'trojan' | 'hysteria2' | 'tuic'
  server: string
  port: number
  cipher?: string
  password?: string
  hasPassword?: boolean
  uuid?: string
  hasUuid?: boolean
  alterId?: number
  network?: 'tcp' | 'ws' | 'grpc'
  security?: 'none' | 'tls' | 'reality'
  sni?: string
  clientFingerprint?: string
  wsPath?: string
  wsHost?: string
  grpcServiceName?: string
  realityPublicKey?: string
  realityShortId?: string
  flow?: string
  plugin?: string
  pluginOptions?: Record<string, string>
  skipCertVerify?: boolean
  obfs?: string
  obfsPassword?: string
  hasObfsPassword?: boolean
  congestionController?: string
  udpRelayMode?: string
}

export type NodeDetail = NodeItem & { connection: ManualNodeConnection | null }

export type RuleModule = 'ads' | 'private' | 'cn'

export type Profile = {
  id: string
  name: string
  enabled: boolean
  protocols: string[]
  tags: string[]
  ruleModules: RuleModule[]
  dnsMode: 'fake-ip' | 'redir-host'
  revision: number
  compiledYaml?: string | null
  compiledAt: string | null
  error: string | null
  sourceIds: string[]
  excludedNodeIds: string[]
  subscriptionUrl: string
}

type LocalNode = NodeItem & { sourceIds: string[]; connection?: ManualNodeConnection }
type LocalState = {
  version: 2
  sources: Source[]
  nodes: LocalNode[]
  profiles: Profile[]
  jobs: Job[]
}

const storageKey = 'wangwang:dev:v1'
const useLocalData = import.meta.env.VITE_DATA_SOURCE
  ? import.meta.env.VITE_DATA_SOURCE === 'local'
  : import.meta.env.DEV

function now() {
  return new Date().toISOString()
}

function seedState(): LocalState {
  const updatedAt = now()
  const sources: Source[] = [
    {
      id: 'source-main',
      name: '主力订阅',
      kind: 'url',
      url: 'https://example.com/sub?***',
      pendingUrl: false,
      profileCount: 1,
      refreshIntervalHours: 6,
      enabled: true,
      status: 'ready',
      warning: null,
      error: null,
      nodeCount: 6,
      lastRefreshedAt: updatedAt,
    },
    {
      id: 'system-manual',
      name: '手动节点',
      kind: 'manual',
      url: null,
      pendingUrl: false,
      profileCount: 0,
      refreshIntervalHours: 0,
      enabled: true,
      status: 'ready',
      warning: null,
      error: null,
      nodeCount: 2,
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

function readState() {
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
          pendingUrl: false,
          profileCount: 0,
          refreshIntervalHours: 0,
          enabled: true,
          status: 'ready' as const,
          warning: null,
          error: null,
          nodeCount: nodes.filter((node) => node.sourceIds.includes('system-manual')).length,
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

function writeState(state: LocalState) {
  localStorage.setItem(storageKey, JSON.stringify(state))
}

function createJob(type: Job['type'], entityId: string, createdAt = now()): Job {
  return { id: crypto.randomUUID(), type, entityId, status: 'succeeded', error: null, createdAt }
}

function displayUrl(value: string) {
  const url = new URL(value)
  return `${url.origin}${url.pathname}${url.search ? '?***' : ''}`
}

function recompileProfiles(state: LocalState, sourceIds: string[], profileIds?: string[]) {
  const enabledSources = new Set(state.sources.filter((source) => source.enabled).map((source) => source.id))
  for (const profile of state.profiles.filter((item) =>
    profileIds ? profileIds.includes(item.id) : item.sourceIds.some((id) => sourceIds.includes(id)),
  )) {
    const available = state.nodes.filter((node) =>
      node.sourceIds.some((id) => profile.sourceIds.includes(id) && enabledSources.has(id)),
    )
    if (available.length) {
      profile.revision += 1
      profile.compiledAt = now()
      profile.compiledYaml = compileYaml(profile.name, available)
      profile.error = null
    } else profile.error = '配置没有可用节点'
    state.jobs.unshift(createJob('compile_profile', profile.id))
  }
}

function updateProfileCounts(state: LocalState) {
  for (const source of state.sources)
    source.profileCount = state.profiles.filter((profile) => profile.sourceIds.includes(source.id)).length
}

function compileYaml(name: string, nodes: NodeItem[]) {
  const proxies = nodes
    .slice(0, 4)
    .map(
      (node) =>
        `  - name: ${node.alias || node.name}\n    type: ${node.protocol}\n    server: ${node.server}\n    port: ${node.port}`,
    )
  return `# ${name}\nmode: rule\nproxies:\n${proxies.join('\n')}\nrules:\n  - GEOIP,CN,DIRECT\n  - MATCH,PROXY\n`
}

function parseBody(init?: RequestInit) {
  if (!init?.body || typeof init.body !== 'string') return {} as Record<string, unknown>
  return JSON.parse(init.body) as Record<string, unknown>
}

function requireItem<T>(item: T | undefined, message: string): T {
  if (!item) throw new Error(message)
  return item
}

async function localApi<T>(path: string, init?: RequestInit): Promise<T> {
  if (init?.signal?.aborted) throw new DOMException('请求已取消', 'AbortError')
  const method = init?.method || 'GET'
  const url = new URL(path, window.location.origin)
  const pathname = url.pathname
  const state = readState()
  const body = parseBody(init)

  if (pathname === '/auth/login' && method === 'POST') return { ok: true } as T
  if (pathname === '/auth/init' && method === 'POST') {
    if (String(body.password || '').length < 12) throw new Error('密码至少需要 12 位')
    if (body.password !== body.confirmPassword) throw new Error('两次密码输入不一致')
    return { ok: true } as T
  }
  if (pathname === '/auth/logout' && method === 'POST') return { ok: true } as T

  if (pathname === '/dashboard' && method === 'GET') {
    return {
      sources: state.sources.filter((source) => source.kind === 'url').length,
      nodes: state.nodes.length,
      profiles: state.profiles.length,
      recentJobs: state.jobs.slice(0, 8),
    } as T
  }

  if (pathname === '/sources' && method === 'GET')
    return state.sources.filter((source) => url.searchParams.get('includeSystem') === '1' || source.kind === 'url') as T
  if (pathname === '/sources' && method === 'POST') {
    if (state.sources.filter((source) => source.kind === 'url').length >= 20) throw new Error('节点源数量已达到 20 个')
    const rawUrl = String(body.url || '')
    if (!rawUrl) throw new Error('订阅地址不能为空')
    const source: Source = {
      id: crypto.randomUUID(),
      name: String(body.name || '').trim(),
      kind: 'url',
      url: displayUrl(rawUrl),
      pendingUrl: false,
      profileCount: 0,
      refreshIntervalHours: Number(body.refreshIntervalHours || 0),
      enabled: true,
      status: 'ready',
      warning: null,
      error: null,
      nodeCount: 0,
      lastRefreshedAt: now(),
    }
    state.sources.unshift(source)
    const job = createJob('refresh_source', source.id)
    state.jobs.unshift(job)
    writeState(state)
    return { sourceId: source.id, jobId: job.id } as T
  }

  const sourceMatch = pathname.match(/^\/sources\/([^/]+)$/)
  if (sourceMatch && method === 'PATCH') {
    const source = requireItem(
      state.sources.find((item) => item.id === sourceMatch[1]),
      '节点源不存在',
    )
    if (typeof body.enabled === 'boolean') source.enabled = body.enabled
    if (typeof body.name === 'string') source.name = body.name.trim()
    if (typeof body.refreshIntervalHours === 'number') source.refreshIntervalHours = body.refreshIntervalHours
    if (typeof body.url === 'string' && body.url) {
      source.url = displayUrl(body.url)
      source.status = 'ready'
      source.lastRefreshedAt = now()
    }
    if (typeof body.enabled === 'boolean') recompileProfiles(state, [source.id])
    const job = typeof body.url === 'string' && body.url ? createJob('refresh_source', source.id) : null
    if (job) state.jobs.unshift(job)
    writeState(state)
    return { source, jobId: job?.id || null } as T
  }
  if (sourceMatch && method === 'DELETE') {
    const sourceId = sourceMatch[1]
    const source = requireItem(
      state.sources.find((item) => item.id === sourceId),
      '节点源不存在',
    )
    const affectedProfiles = state.profiles
      .filter((profile) => profile.sourceIds.includes(sourceId))
      .map((profile) => profile.id)
    const affected = affectedProfiles.length
    const removed = source.nodeCount
    state.sources = state.sources.filter((item) => item.id !== sourceId)
    state.nodes = state.nodes
      .map((node) => ({ ...node, sourceIds: node.sourceIds.filter((id) => id !== sourceId) }))
      .filter((node) => node.sourceIds.length)
    state.profiles = state.profiles.map((profile) => ({
      ...profile,
      sourceIds: profile.sourceIds.filter((id) => id !== sourceId),
    }))
    recompileProfiles(state, [sourceId], affectedProfiles)
    updateProfileCounts(state)
    writeState(state)
    return { id: sourceId, detachedProfileCount: affected, removedNodeCount: removed } as T
  }

  const refreshMatch = pathname.match(/^\/sources\/([^/]+)\/refresh$/)
  if (refreshMatch && method === 'POST') {
    const source = requireItem(
      state.sources.find((item) => item.id === refreshMatch[1]),
      '节点源不存在',
    )
    if (!source.enabled) throw new Error('请先启用节点源')
    source.status = 'ready'
    source.lastRefreshedAt = now()
    const job = createJob('refresh_source', source.id)
    state.jobs.unshift(job)
    writeState(state)
    return { jobId: job.id } as T
  }

  if (pathname === '/nodes' && method === 'POST') {
    if (state.nodes.length >= 2000) throw new Error('全局节点数量已达到 2000 个')
    const connection = body.connection as ManualNodeConnection | undefined
    if (!connection?.name || !connection.server || !connection.port) throw new Error('节点必填字段缺失')
    const signature = JSON.stringify({ ...connection, name: undefined })
    if (
      state.nodes.some(
        (node) => node.connection && JSON.stringify({ ...node.connection, name: undefined }) === signature,
      )
    )
      throw new Error('相同连接参数的节点已存在')
    const node: LocalNode = {
      id: crypto.randomUUID(),
      name: connection.name,
      alias: null,
      protocol: connection.protocol,
      server: connection.server,
      port: connection.port,
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
      enabled: body.enabled !== false,
      updatedAt: now(),
      management: 'manual',
      canEditConnection: true,
      canDelete: true,
      sourceIds: ['system-manual'],
      connection,
    }
    state.nodes.unshift(node)
    const manualSource = requireItem(
      state.sources.find((source) => source.id === 'system-manual'),
      '本地数据迁移未完成',
    )
    manualSource.nodeCount += 1
    recompileProfiles(state, ['system-manual'])
    writeState(state)
    const { sourceIds: _sourceIds, connection: _connection, ...view } = node
    return { node: view } as T
  }

  if (pathname === '/nodes' && method === 'GET') {
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize')) || 50))
    const query = (url.searchParams.get('q') || '').toLowerCase()
    const protocol = url.searchParams.get('protocol') || ''
    const enabled = url.searchParams.get('enabled') || ''
    const rows = state.nodes.filter(
      (node) =>
        (!query || node.name.toLowerCase().includes(query) || node.server.toLowerCase().includes(query)) &&
        (!protocol || node.protocol === protocol) &&
        (!enabled || String(node.enabled) === enabled),
    )
    return {
      items: rows
        .slice((page - 1) * pageSize, page * pageSize)
        .map(({ sourceIds: _sourceIds, connection: _connection, ...node }) => node),
      total: rows.length,
      page,
      pageSize,
    } as T
  }
  if (pathname === '/nodes/batch' && method === 'PATCH') {
    const ids = Array.isArray(body.ids) ? body.ids : []
    state.nodes.forEach((node) => {
      if (ids.includes(node.id)) node.enabled = Boolean(body.enabled)
    })
    recompileProfiles(state, [
      ...new Set(state.nodes.filter((node) => ids.includes(node.id)).flatMap((node) => node.sourceIds)),
    ])
    writeState(state)
    return { ids } as T
  }

  const nodeMatch = pathname.match(/^\/nodes\/([^/]+)$/)
  if (nodeMatch && method === 'GET') {
    const node = requireItem(
      state.nodes.find((item) => item.id === nodeMatch[1]),
      '节点不存在',
    )
    const { sourceIds: _sourceIds, ...detail } = node
    const connection = node.connection
      ? {
          ...node.connection,
          password: '',
          uuid: '',
          obfsPassword: '',
          hasPassword: Boolean(node.connection.password || node.connection.hasPassword),
          hasUuid: Boolean(node.connection.uuid || node.connection.hasUuid),
          hasObfsPassword: Boolean(node.connection.obfsPassword || node.connection.hasObfsPassword),
        }
      : null
    return { ...detail, connection: node.canEditConnection ? connection : null } as T
  }
  if (nodeMatch && method === 'PATCH') {
    const node = requireItem(
      state.nodes.find((item) => item.id === nodeMatch[1]),
      '节点不存在',
    )
    if (body.alias === null || typeof body.alias === 'string') node.alias = body.alias
    if (Array.isArray(body.tags)) node.tags = body.tags.map(String)
    if (typeof body.enabled === 'boolean') node.enabled = body.enabled
    if (body.connection) {
      if (!node.canEditConnection) throw new Error('订阅管理的连接参数不能修改')
      const input = body.connection as ManualNodeConnection
      const connection = {
        ...input,
        password: input.password || node.connection?.password,
        uuid: input.uuid || node.connection?.uuid,
        obfsPassword: input.obfsPassword || node.connection?.obfsPassword,
      }
      node.connection = connection
      node.name = connection.name
      node.protocol = connection.protocol
      node.server = connection.server
      node.port = connection.port
    }
    node.updatedAt = now()
    recompileProfiles(state, node.sourceIds)
    writeState(state)
    const { sourceIds: _sourceIds, connection: _connection, ...view } = node
    return view as T
  }
  if (nodeMatch && method === 'DELETE') {
    const node = requireItem(
      state.nodes.find((item) => item.id === nodeMatch[1]),
      '节点不存在',
    )
    if (!node.sourceIds.includes('system-manual')) throw new Error('订阅管理的节点不能删除')
    node.sourceIds = node.sourceIds.filter((id) => id !== 'system-manual')
    if (!node.sourceIds.length) state.nodes = state.nodes.filter((item) => item.id !== node.id)
    else {
      node.management = 'subscription'
      node.canEditConnection = false
      node.canDelete = false
      node.connection = undefined
    }
    const manualSource = requireItem(
      state.sources.find((source) => source.id === 'system-manual'),
      '本地数据迁移未完成',
    )
    manualSource.nodeCount = state.nodes.filter((item) => item.sourceIds.includes('system-manual')).length
    recompileProfiles(state, ['system-manual'])
    writeState(state)
    return { id: node.id, affectedProfileCount: manualSource.profileCount } as T
  }

  if (pathname === '/profiles' && method === 'GET') return state.profiles as T
  if (pathname === '/profiles' && method === 'POST') {
    if (state.profiles.length >= 20) throw new Error('配置数量已达到 20 个')
    const profile = buildProfile(body, state.nodes, state.sources)
    state.profiles.unshift(profile)
    updateProfileCounts(state)
    const job = createJob('compile_profile', profile.id)
    state.jobs.unshift(job)
    writeState(state)
    return { profileId: profile.id, jobId: job.id } as T
  }

  const compileMatch = pathname.match(/^\/profiles\/([^/]+)\/compile$/)
  if (compileMatch && method === 'POST') {
    const profile = requireItem(
      state.profiles.find((item) => item.id === compileMatch[1]),
      '配置不存在',
    )
    profile.revision += 1
    profile.compiledAt = now()
    profile.compiledYaml = compileYaml(profile.name, state.nodes)
    const job = createJob('compile_profile', profile.id)
    state.jobs.unshift(job)
    writeState(state)
    return { jobId: job.id } as T
  }

  const rotateMatch = pathname.match(/^\/profiles\/([^/]+)\/rotate-token$/)
  if (rotateMatch && method === 'POST') {
    const profile = requireItem(
      state.profiles.find((item) => item.id === rotateMatch[1]),
      '配置不存在',
    )
    profile.subscriptionUrl = `/s/${profile.id}/${crypto.randomUUID()}/config.yaml`
    writeState(state)
    return { subscriptionUrl: profile.subscriptionUrl } as T
  }

  const profileMatch = pathname.match(/^\/profiles\/([^/]+)$/)
  if (profileMatch && method === 'GET') {
    return requireItem(
      state.profiles.find((item) => item.id === profileMatch[1]),
      '配置不存在',
    ) as T
  }
  if (profileMatch && method === 'PATCH') {
    const profile = requireItem(
      state.profiles.find((item) => item.id === profileMatch[1]),
      '配置不存在',
    )
    Object.assign(profile, buildProfile(body, state.nodes, state.sources, profile))
    updateProfileCounts(state)
    const job = createJob('compile_profile', profile.id)
    state.jobs.unshift(job)
    writeState(state)
    return { profileId: profile.id, jobId: job.id } as T
  }
  if (profileMatch && method === 'DELETE') {
    requireItem(
      state.profiles.find((item) => item.id === profileMatch[1]),
      '配置不存在',
    )
    state.profiles = state.profiles.filter((item) => item.id !== profileMatch[1])
    updateProfileCounts(state)
    writeState(state)
    return { id: profileMatch[1] } as T
  }

  const jobMatch = pathname.match(/^\/jobs\/([^/]+)$/)
  if (jobMatch && method === 'GET') {
    return requireItem(
      state.jobs.find((item) => item.id === jobMatch[1]),
      '任务不存在',
    ) as T
  }

  throw new Error(`本地数据模式未实现：${method} ${pathname}`)
}

function buildProfile(
  body: Record<string, unknown>,
  nodes: LocalNode[],
  sources: Source[],
  current?: Profile,
): Profile {
  const id = current?.id || crypto.randomUUID()
  const name = typeof body.name === 'string' ? body.name.trim() : current?.name || '未命名配置'
  const sourceIds = Array.isArray(body.sourceIds) ? body.sourceIds.map(String) : current?.sourceIds || []
  const enabledSources = new Set(sources.filter((source) => source.enabled).map((source) => source.id))
  const availableNodes = nodes.filter((node) =>
    node.sourceIds.some((sourceId) => sourceIds.includes(sourceId) && enabledSources.has(sourceId)),
  )
  return {
    id,
    name,
    enabled: typeof body.enabled === 'boolean' ? body.enabled : (current?.enabled ?? true),
    protocols: Array.isArray(body.protocols) ? body.protocols.map(String) : current?.protocols || [],
    tags: Array.isArray(body.tags) ? body.tags.map(String) : current?.tags || [],
    ruleModules: Array.isArray(body.ruleModules) ? (body.ruleModules as RuleModule[]) : current?.ruleModules || [],
    dnsMode: body.dnsMode === 'redir-host' ? 'redir-host' : current?.dnsMode || 'fake-ip',
    revision: (current?.revision || 0) + 1,
    compiledYaml: compileYaml(name, availableNodes),
    compiledAt: now(),
    error: null,
    sourceIds,
    excludedNodeIds: current?.excludedNodeIds || [],
    subscriptionUrl: current?.subscriptionUrl || `/s/${id}/local-token/config.yaml`,
  }
}

async function httpApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  })
  if (response.status === 401 && path !== '/auth/login') {
    window.location.href = '/admin/login'
    throw new Error('请先登录')
  }
  const payload = (await response.json()) as { data?: T; error?: { message: string } }
  if (!response.ok || payload.data === undefined) throw new Error(payload.error?.message || '请求失败')
  return payload.data
}

export const api = useLocalData ? localApi : httpApi
