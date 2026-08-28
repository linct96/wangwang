export type AuthStatus = {
  initialized: boolean
  authenticated: boolean
}

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
  nodeNameFilter: string | null
  nodeTag: string | null
  userAgent: string
  pendingUrl: boolean
  profileCount: number
  refreshIntervalHours: number
  enabled: boolean
  status: 'idle' | 'refreshing' | 'ready' | 'error'
  warning: string | null
  error: string | null
  nodeCount: number
  lastRefreshedAt: string | null
  uploadBytes: number | null
  downloadBytes: number | null
  totalBytes: number | null
  expireAt: number | null
  infoRefreshedAt: string | null
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

export type NodeDetail = NodeItem & { connection: ManualNodeConnection | null; yaml: string | null }

export type NodeImportResult = {
  created: number
  skipped: number
  warnings: string[]
}

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
