import { useState } from 'react'
import { ChevronDown, Radar, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type { SnifferSettingsDraft, VisualIssue } from '../model'

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

  const currentPorts = value.sniff.TLS?.ports ?? [443, 8443]
  const currentPortsKey = currentPorts.join(',')
  const [prevPortsKey, setPrevPortsKey] = useState(currentPortsKey)
  const [portsText, setPortsText] = useState(() => currentPorts.join(', '))
  const [localPortError, setLocalPortError] = useState('')

  if (prevPortsKey !== currentPortsKey) {
    setPrevPortsKey(currentPortsKey)
    setPortsText(currentPorts.join(', '))
  }

  const update = (patch: Partial<SnifferSettingsDraft>) => onChange({ ...value, ...patch })

  function handlePortsChange(text: string) {
    setPortsText(text)
    const tokens = text
      .split(/[,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)

    if (tokens.length === 0) {
      setLocalPortError('请至少指定一个 TLS 嗅探端口')
      return
    }

    const numbers: number[] = []
    for (const token of tokens) {
      const num = Number(token)
      if (!Number.isInteger(num) || num < 1 || num > 65535) {
        setLocalPortError(`端口 "${token}" 无效，请输入 1-65535 范围内的整数`)
        return
      }
      if (!numbers.includes(num)) {
        numbers.push(num)
      }
    }

    setLocalPortError('')
    onChange({
      ...value,
      sniff: {
        ...value.sniff,
        TLS: { ports: numbers },
      },
    })
  }

  function applyPresetPorts(ports: number[]) {
    setPortsText(ports.join(', '))
    setLocalPortError('')
    onChange({
      ...value,
      sniff: {
        ...value.sniff,
        TLS: { ports },
      },
    })
  }

  const portIssue = issues.find((issue) => issue.snifferField === 'ports' && issue.level === 'error')
  const displayError = localPortError || portIssue?.message

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
            <div className="template-geo-badges hidden sm:flex items-center gap-1.5 ml-1">
              {value.enable ? (
                <>
                  <Badge variant="default">已启用</Badge>
                  <Badge variant="outline">TLS: {currentPorts.join(', ')}</Badge>
                </>
              ) : (
                <Badge variant="secondary">未启用</Badge>
              )}
            </div>
          </div>

          {/* 右侧工具栏操作 */}
          <div className="template-visual-card-actions" onClick={(e) => e.stopPropagation()}>
            {value.enable && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => update({ enable: false })}
                title="关闭流量嗅探"
              >
                <RotateCcw className="size-3 mr-1" />
                关闭嗅探
              </Button>
            )}
          </div>
        </header>

        {expanded && (
          <div className="template-geo-body flex flex-col gap-4 p-4 border-t border-border">
            {/* 总开关 */}
            <div className="flex items-center justify-between gap-4 p-3 rounded-lg border bg-muted/30">
              <div className="space-y-0.5">
                <label htmlFor="template-sniffer-enable" className="text-sm font-medium text-foreground cursor-pointer">
                  启用流量嗅探 (Sniffer)
                </label>
                <p className="text-xs text-muted-foreground">
                  嗅探连接握手信息，解析真实域名并覆盖连接目标，适用于纯 IP 或 fake-ip 场景
                </p>
              </div>
              <Switch
                id="template-sniffer-enable"
                checked={Boolean(value.enable)}
                onCheckedChange={(checked) => update({ enable: checked })}
              />
            </div>

            {value.enable && (
              <div className="flex flex-col gap-4 pt-1">
                {/* 参数开关组 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="flex flex-col justify-between p-3 rounded-lg border bg-background/50 gap-2">
                    <div>
                      <div className="text-xs font-medium text-foreground">强制映射 Fake-IP</div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">强制使用 fake-ip 反向映射获取真实域名</p>
                    </div>
                    <div className="flex justify-end pt-1">
                      <Switch
                        checked={value.forceDnsMapping ?? true}
                        onCheckedChange={(v) => update({ forceDnsMapping: v })}
                        aria-label="强制映射 Fake-IP"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col justify-between p-3 rounded-lg border bg-background/50 gap-2">
                    <div>
                      <div className="text-xs font-medium text-foreground">解析纯 IP</div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        当目标为纯 IP 时仍尝试通过握手包解析域名
                      </p>
                    </div>
                    <div className="flex justify-end pt-1">
                      <Switch
                        checked={value.parsePureIp ?? true}
                        onCheckedChange={(v) => update({ parsePureIp: v })}
                        aria-label="解析纯 IP"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col justify-between p-3 rounded-lg border bg-background/50 gap-2">
                    <div>
                      <div className="text-xs font-medium text-foreground">覆盖目标地址</div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        将嗅探到的域名作为真实目标替换原目标地址
                      </p>
                    </div>
                    <div className="flex justify-end pt-1">
                      <Switch
                        checked={value.overrideDestination ?? true}
                        onCheckedChange={(v) => update({ overrideDestination: v })}
                        aria-label="覆盖目标地址"
                      />
                    </div>
                  </div>
                </div>

                {/* TLS 协议端口设置 */}
                <div className="p-3.5 rounded-lg border bg-background/50 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-semibold text-foreground">TLS 嗅探端口</span>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        指定需嗅探 TLS SNI 信息的目的端口，以逗号分隔
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => applyPresetPorts([443, 8443])}
                        title="重置为默认端口 443, 8443"
                      >
                        <RotateCcw className="size-3 mr-1" />
                        默认 (443, 8443)
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => applyPresetPorts([443, 8443, 2053, 2083, 2087, 2096])}
                        title="添加 Cloudflare 常用 HTTPS 端口"
                      >
                        常用 Web 端口
                      </Button>
                    </div>
                  </div>

                  <Field data-invalid={Boolean(displayError)}>
                    <FieldLabel htmlFor="template-sniffer-tls-ports" className="sr-only">
                      TLS 嗅探端口
                    </FieldLabel>
                    <Input
                      id="template-sniffer-tls-ports"
                      value={portsText}
                      onChange={(e) => handlePortsChange(e.target.value)}
                      placeholder="443, 8443"
                      className="font-mono text-xs"
                      aria-invalid={Boolean(displayError)}
                    />
                    {displayError && <FieldError errors={[{ message: displayError }]} />}
                  </Field>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
