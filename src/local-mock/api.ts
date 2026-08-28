import type { ManualNodeConnection, Profile, RuleModule, Source } from '@/api/types'
import { editableProxyYaml, parseProxyText, proxyConfigError, restoreProxySecrets } from '../../worker/proxy'
import {
  compileYaml,
  createJob,
  displayUrl,
  localNodeTags,
  now,
  readState,
  recompileProfiles,
  updateProfileCounts,
  writeState,
} from './state'
import type { LocalNode } from './state'

function parseBody(init?: RequestInit) {
  if (!init?.body || typeof init.body !== 'string') return {} as Record<string, unknown>
  return JSON.parse(init.body) as Record<string, unknown>
}

function requireItem<T>(item: T | undefined, message: string): T {
  if (!item) throw new Error(message)
  return item
}

const importProtocols = new Set<ManualNodeConnection['protocol']>([
  'ss',
  'vmess',
  'vless',
  'trojan',
  'hysteria2',
  'tuic',
])

function importedConnection(config: Record<string, unknown>): ManualNodeConnection {
  const ws = (config['ws-opts'] || {}) as { path?: string; headers?: { Host?: string } }
  const grpc = (config['grpc-opts'] || {}) as { 'grpc-service-name'?: string }
  const reality = (config['reality-opts'] || {}) as { 'public-key'?: string; 'short-id'?: string }
  return {
    name: String(config.name),
    protocol: String(config.type) as ManualNodeConnection['protocol'],
    server: String(config.server),
    port: Number(config.port),
    cipher: config.cipher ? String(config.cipher) : undefined,
    password: config.password ? String(config.password) : undefined,
    uuid: config.uuid ? String(config.uuid) : undefined,
    alterId: config.alterId === undefined ? undefined : Number(config.alterId),
    network: (config.network || 'tcp') as ManualNodeConnection['network'],
    security: reality['public-key'] ? 'reality' : config.tls ? 'tls' : 'none',
    sni: config.servername || config.sni ? String(config.servername || config.sni) : undefined,
    clientFingerprint: config['client-fingerprint'] ? String(config['client-fingerprint']) : undefined,
    wsPath: ws.path,
    wsHost: ws.headers?.Host,
    grpcServiceName: grpc['grpc-service-name'],
    realityPublicKey: reality['public-key'],
    realityShortId: reality['short-id'],
    flow: config.flow ? String(config.flow) : undefined,
    plugin: config.plugin ? String(config.plugin) : undefined,
    pluginOptions: config['plugin-opts'] as Record<string, string> | undefined,
    skipCertVerify: Boolean(config['skip-cert-verify']),
    obfs: config.obfs ? String(config.obfs) : undefined,
    obfsPassword: config['obfs-password'] ? String(config['obfs-password']) : undefined,
    congestionController: config['congestion-controller'] ? String(config['congestion-controller']) : undefined,
    udpRelayMode: config['udp-relay-mode'] ? String(config['udp-relay-mode']) : undefined,
  }
}

function connectionKey(connection: ManualNodeConnection) {
  return JSON.stringify({ ...connection, name: undefined })
}

function connectionConfig(connection: ManualNodeConnection) {
  const config: Record<string, unknown> & { name: string; type: string; server: string; port: number } = {
    name: connection.name,
    type: connection.protocol,
    server: connection.server,
    port: connection.port,
    udp: true,
  }
  if (connection.cipher) config.cipher = connection.cipher
  if (connection.password) config.password = connection.password
  if (connection.uuid) config.uuid = connection.uuid
  if (connection.alterId !== undefined) config.alterId = connection.alterId
  if (connection.flow) config.flow = connection.flow
  if (connection.plugin) config.plugin = connection.plugin
  if (connection.pluginOptions) config['plugin-opts'] = connection.pluginOptions
  if (connection.network && connection.network !== 'tcp') config.network = connection.network
  if (connection.network === 'ws')
    config['ws-opts'] = {
      path: connection.wsPath || '/',
      headers: connection.wsHost ? { Host: connection.wsHost } : undefined,
    }
  if (connection.network === 'grpc') config['grpc-opts'] = { 'grpc-service-name': connection.grpcServiceName || '' }
  if (connection.security && connection.security !== 'none') {
    config.tls = true
    config.servername = connection.sni || connection.server
  }
  if (connection.security === 'reality')
    config['reality-opts'] = {
      'public-key': connection.realityPublicKey || '',
      'short-id': connection.realityShortId || '',
    }
  if (connection.clientFingerprint) config['client-fingerprint'] = connection.clientFingerprint
  if (connection.skipCertVerify) config['skip-cert-verify'] = true
  if (connection.obfs) config.obfs = connection.obfs
  if (connection.obfsPassword) config['obfs-password'] = connection.obfsPassword
  if (connection.congestionController) config['congestion-controller'] = connection.congestionController
  if (connection.udpRelayMode) config['udp-relay-mode'] = connection.udpRelayMode
  return config
}

export async function localApi<T>(path: string, init?: RequestInit): Promise<T> {
  if (init?.signal?.aborted) throw new DOMException('请求已取消', 'AbortError')
  const method = init?.method || 'GET'
  const url = new URL(path, window.location.origin)
  const pathname = url.pathname
  const state = readState()
  const body = parseBody(init)

  if (pathname === '/auth/status' && method === 'GET') {
    const initialized = localStorage.getItem('wangwang:local-admin') === '1'
    return { initialized, authenticated: initialized } as T
  }
  if (pathname === '/auth/login' && method === 'POST') return { ok: true } as T
  if (pathname === '/auth/init' && method === 'POST') {
    if (String(body.password || '').length < 12) throw new Error('密码至少需要 12 位')
    if (body.password !== body.confirmPassword) throw new Error('两次密码输入不一致')
    localStorage.setItem('wangwang:local-admin', '1')
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
      name: String(body.name || '').trim() || new URL(rawUrl).hostname,
      kind: 'url',
      url: displayUrl(rawUrl),
      nodeNameFilter: String(body.nodeNameFilter || '').trim() || null,
      nodeTag: String(body.nodeTag || '').trim() || null,
      pendingUrl: false,
      profileCount: 0,
      refreshIntervalHours: Number(body.refreshIntervalHours || 0),
      enabled: true,
      status: 'ready',
      warning: null,
      error: null,
      nodeCount: 0,
      uploadBytes: null,
      downloadBytes: null,
      totalBytes: null,
      expireAt: null,
      infoRefreshedAt: null,
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
    if (typeof body.nodeNameFilter === 'string') source.nodeNameFilter = body.nodeNameFilter.trim() || null
    if (typeof body.nodeTag === 'string') source.nodeTag = body.nodeTag.trim() || null
    if (typeof body.url === 'string' && body.url) {
      source.url = displayUrl(body.url)
      source.status = 'ready'
      source.lastRefreshedAt = now()
    }
    if (typeof body.enabled === 'boolean' || typeof body.nodeTag === 'string') recompileProfiles(state, [source.id])
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

  if (pathname === '/nodes/import' && method === 'POST') {
    const parsed = await parseProxyText(String(body.content || ''))
    const supported = parsed.nodes.filter(
      (node) =>
        importProtocols.has(node.config.type as ManualNodeConnection['protocol']) && !proxyConfigError(node.config),
    )
    const existing = new Set(state.nodes.flatMap((node) => (node.connection ? [connectionKey(node.connection)] : [])))
    const imported = supported
      .map(({ config }) => importedConnection(config))
      .filter((connection) => {
        const key = connectionKey(connection)
        if (existing.has(key)) return false
        existing.add(key)
        return true
      })
    if (state.nodes.length + imported.length > 2000)
      throw new Error(`最多还能导入 ${Math.max(0, 2000 - state.nodes.length)} 个节点`)

    const tags = Array.isArray(body.tags) ? [...new Set(body.tags.map(String))] : []
    for (const connection of imported) {
      state.nodes.unshift({
        id: crypto.randomUUID(),
        name: connection.name,
        alias: null,
        protocol: connection.protocol,
        server: connection.server,
        port: connection.port,
        tags,
        enabled: body.enabled !== false,
        updatedAt: now(),
        management: 'manual',
        canEditConnection: true,
        canDelete: true,
        sourceIds: ['system-manual'],
        connection,
      })
    }
    const manualSource = requireItem(
      state.sources.find((source) => source.id === 'system-manual'),
      '本地数据迁移未完成',
    )
    manualSource.nodeCount = state.nodes.filter((node) => node.sourceIds.includes('system-manual')).length
    if (imported.length) recompileProfiles(state, ['system-manual'])
    writeState(state)
    const rejectedWarnings = parsed.nodes.flatMap((node) => {
      if (!importProtocols.has(node.config.type as ManualNodeConnection['protocol']))
        return [`${node.config.name}：不支持 ${node.config.type} 协议`]
      const error = proxyConfigError(node.config)
      return error ? [`${node.config.name}：${error}`] : []
    })
    const warnings = [...parsed.warnings, ...rejectedWarnings.slice(0, Math.max(0, 20 - parsed.warnings.length))]
    return {
      created: imported.length,
      skipped: parsed.nodes.length - imported.length,
      warnings,
    } as T
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
    const tag = url.searchParams.get('tag') || ''
    const sourceId = url.searchParams.get('sourceId') || ''
    const enabled = url.searchParams.get('enabled') || ''
    const rows = state.nodes.filter((node) => {
      const tags = localNodeTags(state, node)
      return (
        (!query || node.name.toLowerCase().includes(query) || node.server.toLowerCase().includes(query)) &&
        (!protocol || node.protocol === protocol) &&
        (!tag || tags.includes(tag)) &&
        (!sourceId || node.sourceIds.includes(sourceId)) &&
        (!enabled || String(node.enabled) === enabled)
      )
    })
    return {
      items: rows.slice((page - 1) * pageSize, page * pageSize).map((node) => {
        const { sourceIds: _sourceIds, connection: _connection, ...view } = node
        return { ...view, tags: localNodeTags(state, node) }
      }),
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
    return {
      ...detail,
      tags: localNodeTags(state, node),
      connection: node.canEditConnection ? connection : null,
      yaml: node.canEditConnection && node.connection ? editableProxyYaml(connectionConfig(node.connection)) : null,
    } as T
  }
  if (nodeMatch && method === 'PATCH') {
    const node = requireItem(
      state.nodes.find((item) => item.id === nodeMatch[1]),
      '节点不存在',
    )
    if (body.alias === null || typeof body.alias === 'string') node.alias = body.alias
    if (Array.isArray(body.tags)) {
      const sourceTags = new Set(localNodeTags(state, { ...node, tags: [] }))
      node.tags = body.tags.map(String).filter((tag) => !sourceTags.has(tag))
    }
    if (typeof body.enabled === 'boolean') node.enabled = body.enabled
    let connection: ManualNodeConnection | undefined
    if (typeof body.yaml === 'string') {
      if (!node.canEditConnection) throw new Error('订阅管理的连接参数不能修改')
      const parsed = await parseProxyText(body.yaml)
      if (parsed.nodes.length !== 1) throw new Error('YAML 必须且只能包含一个节点')
      if (!importProtocols.has(parsed.nodes[0]!.config.type as ManualNodeConnection['protocol']))
        throw new Error(`不支持 ${parsed.nodes[0]!.config.type} 协议`)
      const current = connectionConfig(requireItem(node.connection, '节点连接参数不存在'))
      const config = restoreProxySecrets(parsed.nodes[0]!.config, current)
      const error = proxyConfigError(config)
      if (error) throw new Error(error)
      connection = importedConnection(config)
    } else if (body.connection) {
      if (!node.canEditConnection) throw new Error('订阅管理的连接参数不能修改')
      const input = body.connection as ManualNodeConnection
      connection = {
        ...input,
        password: input.password || node.connection?.password,
        uuid: input.uuid || node.connection?.uuid,
        obfsPassword: input.obfsPassword || node.connection?.obfsPassword,
      }
    }
    if (connection) {
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

export function buildProfile(
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
