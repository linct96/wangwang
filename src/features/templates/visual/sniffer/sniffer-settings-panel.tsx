import { useState } from 'react'
import { ChevronDown, Radar } from 'lucide-react'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
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

  const isSnifferEnabled = Boolean(value.enable)

  const generalPortsIssue = issues.find((i) => i.snifferField === 'ports' && i.level === 'error')?.message

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
          </div>
        </header>

        {expanded && (
          <div className="template-geo-body p-4 pt-3.5 border-t border-border">
            <FieldGroup className="gap-5">
              {/* 1. 基础全局配置（双列网格 Switch 卡片） */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  orientation="horizontal"
                  className="justify-between rounded-lg border border-border/60 bg-card/40 p-3 transition-colors"
                >
                  <div className="flex flex-col gap-0.5 pr-2">
                    <FieldLabel htmlFor="template-sniffer-enable" className="cursor-pointer mb-0">
                      启用流量嗅探
                    </FieldLabel>
                    <FieldDescription className="text-xs">开启后自动分析连接流量协议并提取真实域名</FieldDescription>
                  </div>
                  <Switch
                    id="template-sniffer-enable"
                    checked={isSnifferEnabled}
                    onCheckedChange={(checked) => update({ enable: checked })}
                    aria-label="启用流量嗅探"
                  />
                </Field>

                <Field
                  orientation="horizontal"
                  className={cn(
                    'justify-between rounded-lg border border-border/60 bg-card/40 p-3 transition-colors',
                    !isSnifferEnabled && 'opacity-50',
                  )}
                >
                  <div className="flex flex-col gap-0.5 pr-2">
                    <FieldLabel
                      htmlFor="template-sniffer-force-dns"
                      className={cn('mb-0', isSnifferEnabled && 'cursor-pointer')}
                    >
                      强制映射 Fake-IP
                    </FieldLabel>
                    <FieldDescription className="text-xs">连接目标为 Fake-IP 时强制映射回真实域名</FieldDescription>
                  </div>
                  <Switch
                    id="template-sniffer-force-dns"
                    disabled={!isSnifferEnabled}
                    checked={Boolean(value.forceDnsMapping ?? true)}
                    onCheckedChange={(checked) => update({ forceDnsMapping: checked })}
                  />
                </Field>

                <Field
                  orientation="horizontal"
                  className={cn(
                    'justify-between rounded-lg border border-border/60 bg-card/40 p-3 transition-colors',
                    !isSnifferEnabled && 'opacity-50',
                  )}
                >
                  <div className="flex flex-col gap-0.5 pr-2">
                    <FieldLabel
                      htmlFor="template-sniffer-override-dest"
                      className={cn('mb-0', isSnifferEnabled && 'cursor-pointer')}
                    >
                      覆盖目标地址 (全局)
                    </FieldLabel>
                    <FieldDescription className="text-xs">使用嗅探到的真实域名覆盖目标连接地址</FieldDescription>
                  </div>
                  <Switch
                    id="template-sniffer-override-dest"
                    disabled={!isSnifferEnabled}
                    checked={Boolean(value.overrideDestination ?? true)}
                    onCheckedChange={(checked) => update({ overrideDestination: checked })}
                  />
                </Field>

                <Field
                  orientation="horizontal"
                  className={cn(
                    'justify-between rounded-lg border border-border/60 bg-card/40 p-3 transition-colors',
                    !isSnifferEnabled && 'opacity-50',
                  )}
                >
                  <div className="flex flex-col gap-0.5 pr-2">
                    <FieldLabel
                      htmlFor="template-sniffer-parse-pure-ip"
                      className={cn('mb-0', isSnifferEnabled && 'cursor-pointer')}
                    >
                      解析纯 IP
                    </FieldLabel>
                    <FieldDescription className="text-xs">对直接请求纯 IP 的连接反查解析域名</FieldDescription>
                  </div>
                  <Switch
                    id="template-sniffer-parse-pure-ip"
                    disabled={!isSnifferEnabled}
                    checked={Boolean(value.parsePureIp ?? true)}
                    onCheckedChange={(checked) => update({ parsePureIp: checked })}
                  />
                </Field>
              </div>

              <div className="h-px bg-border/60" />

              {/* 3. 协议嗅探配置 */}
              <div className={cn('flex flex-col gap-3', !isSnifferEnabled && 'opacity-50')}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <div>
                    <span className="text-sm font-semibold text-foreground">协议嗅探 (Sniff Protocols)</span>
                    <p className="text-xs text-muted-foreground mt-0.5">针对不同协议单独配置嗅探端口与目标覆盖规则</p>
                  </div>
                  {isSnifferEnabled && generalPortsIssue && (
                    <FieldError errors={[{ message: generalPortsIssue }]} className="text-xs sm:text-right" />
                  )}
                </div>

                <div className="flex flex-col gap-3">
                  {PROTOCOL_CONFIGS.map(({ key, label, field, defaultPorts, placeholder }) => {
                    const protoDraft = value.sniff[key]
                    const isEnabled = Boolean(protoDraft && protoDraft.ports && protoDraft.ports.length > 0)
                    const text = portTexts[key] ?? (protoDraft?.ports.join(', ') || defaultPorts.join(', '))
                    const issueError = issues.find(
                      (i) => (i.snifferField === field || i.snifferField === 'ports') && i.level === 'error',
                    )?.message
                    const error = isSnifferEnabled && isEnabled ? portErrors[key] || issueError : undefined
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
                          'rounded-lg border p-3.5 transition-colors',
                          isSnifferEnabled && isEnabled
                            ? 'border-border bg-card/60'
                            : 'border-border/40 bg-muted/20 opacity-75',
                        )}
                      >
                        <div className="flex items-center justify-between pb-2.5 border-b border-border/40 mb-3">
                          <span className="font-medium text-sm text-foreground">{label} 嗅探</span>
                          <Switch
                            id={`template-sniffer-${key}`}
                            disabled={!isSnifferEnabled}
                            checked={isEnabled}
                            onCheckedChange={(checked) => handleProtoToggle(key, checked, defaultPorts)}
                            aria-label={`启用 ${label} 嗅探`}
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <Field data-invalid={Boolean(error)}>
                            <FieldLabel htmlFor={`template-sniffer-ports-${key}`}>嗅探端口</FieldLabel>
                            <Input
                              id={`template-sniffer-ports-${key}`}
                              value={text}
                              disabled={!isSnifferEnabled || !isEnabled}
                              onChange={(e) => handlePortChange(key, e.target.value)}
                              placeholder={placeholder}
                              className="font-mono text-sm"
                              aria-invalid={Boolean(error)}
                            />
                            {error && <FieldError errors={[{ message: error }]} />}
                          </Field>

                          <Field>
                            <FieldLabel htmlFor={`template-sniffer-override-${key}`}>目标覆盖</FieldLabel>
                            <Select
                              disabled={!isSnifferEnabled || !isEnabled}
                              value={overrideVal}
                              onValueChange={(v) => handleOverrideChange(key, v)}
                            >
                              <SelectTrigger id={`template-sniffer-override-${key}`} className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="default">跟随全局</SelectItem>
                                <SelectItem value="true">开启</SelectItem>
                                <SelectItem value="false">关闭</SelectItem>
                              </SelectContent>
                            </Select>
                          </Field>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="h-px bg-border/60" />

              {/* 4. 跳过域名配置 */}
              <Field className={cn(!isSnifferEnabled && 'opacity-50')}>
                <FieldLabel htmlFor="template-sniffer-skip-domain">跳过域名 (Skip Domain)</FieldLabel>
                <Textarea
                  id="template-sniffer-skip-domain"
                  disabled={!isSnifferEnabled}
                  value={skipDomainText}
                  onChange={(e) => handleSkipDomainChange(e.target.value)}
                  placeholder={'Mijia Cloud\n+.push.apple.com'}
                  className="font-mono text-sm min-h-[96px] resize-y"
                />
                <FieldDescription className="text-xs">
                  每行一个域名或通配符（例如 <code>+.push.apple.com</code> 或 <code>Mijia Cloud</code>
                  ），匹配这些域名的连接将跳过嗅探
                </FieldDescription>
              </Field>
            </FieldGroup>
          </div>
        )}
      </div>
    </section>
  )
}
