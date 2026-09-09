import { useState } from 'react'
import { ChevronDown, Radar } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { SnifferSettingsDraft, VisualIssue } from '../model'

type ProtoKey = 'TLS' | 'HTTP' | 'QUIC'

const PROTOCOL_CONFIGS: {
  key: ProtoKey
  label: string
  field: 'tls-ports' | 'http-ports' | 'quic-ports'
  defaultPorts: (number | string)[]
  placeholder: string
}[] = [
  {
    key: 'TLS',
    label: 'TLS',
    field: 'tls-ports',
    defaultPorts: [443, 8443],
    placeholder: '443, 8443',
  },
  {
    key: 'HTTP',
    label: 'HTTP',
    field: 'http-ports',
    defaultPorts: [80, '8080-8880'],
    placeholder: '80, 8080-8880',
  },
  {
    key: 'QUIC',
    label: 'QUIC',
    field: 'quic-ports',
    defaultPorts: [443, 8443],
    placeholder: '443, 8443',
  },
]

function parsePortsInput(text: string): { ports: (number | string)[]; error?: string } {
  const tokens = text
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)

  if (tokens.length === 0) {
    return { ports: [], error: '请至少指定一个嗅探端口' }
  }

  const ports: (number | string)[] = []
  for (const token of tokens) {
    const rangeMatch = token.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10)
      const end = parseInt(rangeMatch[2], 10)
      if (start < 1 || end > 65535 || start > end) {
        return { ports: [], error: `端口范围 "${token}" 无效 (1-65535 且起始 <= 结束)` }
      }
      if (!ports.includes(token)) ports.push(token)
      continue
    }

    const num = Number(token)
    if (!Number.isInteger(num) || num < 1 || num > 65535) {
      return { ports: [], error: `端口 "${token}" 无效，请输入 1-65535 的端口或范围` }
    }
    if (!ports.includes(num)) {
      ports.push(num)
    }
  }

  return { ports }
}

export function SnifferSettingsPanel({
  value,
  issues,
  onChange,
}: {
  value: SnifferSettingsDraft
  issues: VisualIssue[]
  onChange: (value: SnifferSettingsDraft) => void
}) {
  const [expanded, setExpanded] = useState(true)

  // 端口文本与输入错误本地状态
  const sniffKey = PROTOCOL_CONFIGS.map(({ key }) => `${key}:${(value.sniff[key]?.ports ?? []).join(',')}`).join('|')
  const [prevSniffKey, setPrevSniffKey] = useState(sniffKey)
  const [portTexts, setPortTexts] = useState<Record<ProtoKey, string>>(() => ({
    TLS: value.sniff.TLS?.ports?.join(', ') ?? '443, 8443',
    HTTP: value.sniff.HTTP?.ports?.join(', ') ?? '80, 8080-8880',
    QUIC: value.sniff.QUIC?.ports?.join(', ') ?? '443, 8443',
  }))
  const [portErrors, setPortErrors] = useState<Record<ProtoKey, string>>({
    TLS: '',
    HTTP: '',
    QUIC: '',
  })

  if (prevSniffKey !== sniffKey) {
    setPrevSniffKey(sniffKey)
    setPortTexts({
      TLS: value.sniff.TLS?.ports?.join(', ') ?? '443, 8443',
      HTTP: value.sniff.HTTP?.ports?.join(', ') ?? '80, 8080-8880',
      QUIC: value.sniff.QUIC?.ports?.join(', ') ?? '443, 8443',
    })
  }

  // 跳过域名文本本地状态
  const skipDomainKey = (value.skipDomain ?? []).join('\n')
  const [prevSkipDomainKey, setPrevSkipDomainKey] = useState(skipDomainKey)
  const [skipDomainText, setSkipDomainText] = useState(() => skipDomainKey)

  if (prevSkipDomainKey !== skipDomainKey) {
    setPrevSkipDomainKey(skipDomainKey)
    setSkipDomainText(skipDomainKey)
  }

  const update = (patch: Partial<SnifferSettingsDraft>) => onChange({ ...value, ...patch })

  const handlePortChange = (proto: ProtoKey, text: string) => {
    setPortTexts((prev) => ({ ...prev, [proto]: text }))
    const res = parsePortsInput(text)
    setPortErrors((prev) => ({ ...prev, [proto]: res.error || '' }))
    if (!res.error) {
      const current = value.sniff[proto]
      onChange({
        ...value,
        sniff: {
          ...value.sniff,
          [proto]: {
            ...current,
            ports: res.ports,
          },
        },
      })
    }
  }

  const handleProtoToggle = (proto: ProtoKey, checked: boolean, defaultPorts: (number | string)[]) => {
    if (checked) {
      const current = value.sniff[proto]
      const ports = current?.ports && current.ports.length > 0 ? current.ports : defaultPorts
      setPortTexts((prev) => ({ ...prev, [proto]: ports.join(', ') }))
      setPortErrors((prev) => ({ ...prev, [proto]: '' }))
      onChange({
        ...value,
        sniff: {
          ...value.sniff,
          [proto]: {
            ...current,
            ports,
          },
        },
      })
    } else {
      const nextSniff = { ...value.sniff }
      delete nextSniff[proto]
      setPortErrors((prev) => ({ ...prev, [proto]: '' }))
      onChange({
        ...value,
        sniff: nextSniff,
      })
    }
  }

  const handleOverrideChange = (proto: ProtoKey, val: string) => {
    const current = value.sniff[proto]
    if (!current) return
    const overrideDestination = val === 'default' ? undefined : val === 'true'
    onChange({
      ...value,
      sniff: {
        ...value.sniff,
        [proto]: {
          ...current,
          overrideDestination,
        },
      },
    })
  }

  const handleSkipDomainChange = (text: string) => {
    setSkipDomainText(text)
    const list = text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    update({ skipDomain: list.length > 0 ? list : undefined })
  }

  return (
    <section className="template-visual-section">
      <div className="template-visual-card template-geo-card">
        {/* 卡片头部 */}
        <header className="template-visual-card-header template-geo-header">
          <div
            className="template-group-header-info"
            role="button"
            tabIndex={0}
            onClick={() => setExpanded((prev) => !prev)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setExpanded((prev) => !prev)
              }
            }}
          >
            <ChevronDown className={cn('template-collapse-icon', expanded && 'expanded')} />
            <div className="flex items-center gap-2">
              <Radar className="size-4 text-purple-500" />
              <strong>流量嗅探 (Sniffer)</strong>
            </div>

            {/* 状态徽标组 */}
            <div className="template-geo-badges hidden sm:flex items-center gap-1.5 ml-1 flex-wrap">
              {value.enable ? (
                <>
                  <Badge variant="default">已启用</Badge>
                  {PROTOCOL_CONFIGS.map(({ key, label }) => {
                    const proto = value.sniff[key]
                    if (!proto?.ports?.length) return null
                    return (
                      <Badge key={key} variant="outline" className="font-mono text-xs">
                        {label}: {proto.ports.join(', ')}
                      </Badge>
                    )
                  })}
                  {(value.skipDomain?.length ?? 0) > 0 && (
                    <Badge variant="secondary">跳过 {value.skipDomain!.length} 个域名</Badge>
                  )}
                </>
              ) : (
                <Badge variant="secondary">未启用</Badge>
              )}
            </div>
          </div>

          {/* 右侧工具栏操作：启用开关 */}
          <div className="template-visual-card-actions" onClick={(e) => e.stopPropagation()}>
            <Switch
              id="template-sniffer-enable"
              checked={Boolean(value.enable)}
              onCheckedChange={(checked) => {
                update({ enable: checked })
                if (checked) {
                  setExpanded(true)
                }
              }}
              aria-label="启用流量嗅探"
            />
          </div>
        </header>

        {expanded && (
          <div className="template-geo-body p-4 pt-3.5 border-t border-border flex flex-col gap-4">
            {value.enable ? (
              <>
                {/* 1. 基础全局配置：左右双列 + 中间分割线 */}
                <div className="grid grid-cols-1 md:grid-cols-2 md:divide-x md:divide-border/40">
                  {/* 左列 */}
                  <div className="flex flex-col gap-3 md:pr-6">
                    {/* 强制映射 Fake-IP */}
                    <div className="flex items-center justify-between gap-3 min-h-9">
                      <FieldLabel
                        htmlFor="template-sniffer-force-dns"
                        className="mb-0 text-sm font-medium cursor-pointer"
                      >
                        强制映射 Fake-IP
                      </FieldLabel>
                      <Select
                        value={String(value.forceDnsMapping ?? true)}
                        onValueChange={(v) => update({ forceDnsMapping: v === 'true' })}
                      >
                        <SelectTrigger id="template-sniffer-force-dns" className="w-32 shrink-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true">开启</SelectItem>
                          <SelectItem value="false">关闭</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* 覆盖目标地址 */}
                    <div className="flex items-center justify-between gap-3 min-h-9">
                      <FieldLabel
                        htmlFor="template-sniffer-override-dest"
                        className="mb-0 text-sm font-medium cursor-pointer"
                      >
                        覆盖目标地址
                      </FieldLabel>
                      <Select
                        value={String(value.overrideDestination ?? true)}
                        onValueChange={(v) => update({ overrideDestination: v === 'true' })}
                      >
                        <SelectTrigger id="template-sniffer-override-dest" className="w-32 shrink-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true">开启</SelectItem>
                          <SelectItem value="false">关闭</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* 右列 */}
                  <div className="flex flex-col gap-3 pt-3 md:pt-0 md:pl-6">
                    {/* 解析纯 IP */}
                    <div className="flex items-center justify-between gap-3 min-h-9">
                      <FieldLabel
                        htmlFor="template-sniffer-parse-pure-ip"
                        className="mb-0 text-sm font-medium cursor-pointer"
                      >
                        解析纯 IP
                      </FieldLabel>
                      <Select
                        value={String(value.parsePureIp ?? true)}
                        onValueChange={(v) => update({ parsePureIp: v === 'true' })}
                      >
                        <SelectTrigger id="template-sniffer-parse-pure-ip" className="w-32 shrink-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true">开启</SelectItem>
                          <SelectItem value="false">关闭</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* 2. 协议嗅探配置 */}
                <div className="flex flex-col gap-2.5 pt-3 border-t border-border/40">
                  <span className="text-xs font-semibold text-muted-foreground">协议嗅探 (Sniff Protocols)</span>

                  <div className="flex flex-col gap-2">
                    {PROTOCOL_CONFIGS.map(({ key, label, field, defaultPorts, placeholder }) => {
                      const protoDraft = value.sniff[key]
                      const isEnabled = Boolean(protoDraft && protoDraft.ports && protoDraft.ports.length > 0)
                      const text = portTexts[key] ?? (protoDraft?.ports.join(', ') || defaultPorts.join(', '))
                      const issueError = issues.find(
                        (i) => (i.snifferField === field || i.snifferField === 'ports') && i.level === 'error',
                      )?.message
                      const error = isEnabled ? portErrors[key] || issueError : undefined
                      const overrideVal =
                        protoDraft?.overrideDestination === true
                          ? 'true'
                          : protoDraft?.overrideDestination === false
                            ? 'false'
                            : 'default'

                      return (
                        <div
                          key={key}
                          className={cn(
                            'flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-2.5 rounded-lg border transition-colors',
                            isEnabled ? 'border-border/70 bg-background/50' : 'border-border/30 bg-muted/10 opacity-70',
                          )}
                        >
                          <div className="flex items-center gap-3 shrink-0 sm:w-28">
                            <Switch
                              id={`template-sniffer-${key}`}
                              checked={isEnabled}
                              onCheckedChange={(checked) => handleProtoToggle(key, checked, defaultPorts)}
                              aria-label={`启用 ${label} 嗅探`}
                            />
                            <FieldLabel
                              htmlFor={`template-sniffer-${key}`}
                              className="mb-0 text-sm font-medium cursor-pointer"
                            >
                              {label}
                            </FieldLabel>
                          </div>

                          <div className="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                            <div className="flex-1 flex flex-col gap-1">
                              <Input
                                value={text}
                                disabled={!isEnabled}
                                onChange={(e) => handlePortChange(key, e.target.value)}
                                placeholder={placeholder}
                                className="font-mono text-xs h-8"
                                aria-invalid={Boolean(error)}
                              />
                              {error && <FieldError errors={[{ message: error }]} />}
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0 justify-end">
                              <span className="text-xs text-muted-foreground whitespace-nowrap hidden md:inline">
                                目标覆盖:
                              </span>
                              <Select
                                disabled={!isEnabled}
                                value={overrideVal}
                                onValueChange={(v) => handleOverrideChange(key, v)}
                              >
                                <SelectTrigger className="w-28 h-8 text-xs shrink-0">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="default">跟随全局</SelectItem>
                                  <SelectItem value="true">开启</SelectItem>
                                  <SelectItem value="false">关闭</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* 3. 跳过域名配置 */}
                <div className="flex flex-col gap-2 pt-3 border-t border-border/40">
                  <div className="flex items-center justify-between">
                    <FieldLabel
                      htmlFor="template-sniffer-skip-domain"
                      className="mb-0 text-xs font-semibold text-muted-foreground cursor-pointer"
                    >
                      跳过域名 (Skip Domain)
                    </FieldLabel>
                    <span className="text-[11px] text-muted-foreground">每行一个域名或通配符</span>
                  </div>
                  <Textarea
                    id="template-sniffer-skip-domain"
                    value={skipDomainText}
                    onChange={(e) => handleSkipDomainChange(e.target.value)}
                    placeholder={'Mijia Cloud\n+.push.apple.com'}
                    className="font-mono text-xs min-h-[72px] resize-y"
                  />
                </div>
              </>
            ) : (
              <div className="py-4 text-center text-xs text-muted-foreground">
                流量嗅探未启用，开启右上角开关后可配置相关参数
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
