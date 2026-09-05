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
  nodeTags: string[]
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

export type TagOption = {
  id: string
  name: string
}

export type NodeItem = {
  id: string
  name: string
  alias: string | null
  protocol: string
  server: string
  port: number
  url: string | null
  tags: string[]
  directTags: TagOption[]
  inheritedTags: TagOption[]
  enabled: boolean
  updatedAt: string
  management: 'subscription' | 'manual'
  canEditConnection: boolean
  canDelete: boolean
}

export type ManualNodeConnection = {
  name: string
  protocol: 'ss' | 'vmess' | 'vless' | 'trojan' | 'hysteria2' | 'tuic' | 'anytls'
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

export type TemplateSourceSlot = { key: string; name: string }
export type ProfileNodeBinding =
  | {
      mode: 'source'
      sourceIds: string[]
      includeRegex: string | null
      excludeRegex: string | null
    }
  | {
      mode: 'node'
      nodeIds: string[]
      missingNodeIds: string[]
    }
  | {
      mode: 'tag'
      tags: string[]
      includeRegex: string | null
      excludeRegex: string | null
    }
export type ProfileSlotBinding = ProfileNodeBinding & { slotKey: string }

export type NodeOption = {
  id: string
  physicalNodeId: string
  name: string
  sourceId: string
  sourceName: string
  enabled: boolean
  sourceEnabled: boolean
  tags: string[]
}

export type TemplateId = 'builtin:minimal' | 'builtin:standard' | 'builtin:full' | (string & {})

export type TemplateSummary = {
  id: TemplateId
  name: string
  description: string | null
  kind: 'builtin' | 'custom'
  readOnly: boolean
  profileCount: number
  sourceSlots: TemplateSourceSlot[]
  createdAt: string | null
  updatedAt: string | null
}

export type TemplateDetail = TemplateSummary & { yaml: string }
export type TemplatePreview = { yaml: string; nodeCount: number }

export type Profile = {
  id: string
  name: string
  enabled: boolean
  tags: string[]
  templateId: TemplateId
  revision: number
  compiledYaml?: string | null
  compiledAt: string | null
  error: string | null
  nodeBinding: ProfileNodeBinding
  slotBindings: ProfileSlotBinding[]
  subscriptionUrl: string
}

export type ProfileYamlPreview = {
  yaml: string
  error?: string | null
  nodeCount: number
}
