import { useState } from 'react'
import { ChevronDown, Database, Globe, Replace, Sparkles, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { IconButton } from '@/components/app-primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type { GeoSettingsDraft, VisualIssue } from '../model'
import {
  applyGhProxyToGeoUrls,
  createEmptyGeoSettings,
  createLiteGeoSettings,
  createLoyalsoldierGeoSettings,
  createRecommendedGeoSettings,
  detectActivePreset,
} from './presets'

type GeoUrlKey = 'geosite' | 'geoip' | 'mmdb' | 'asn'

interface GeoFieldConfig {
  key: GeoUrlKey
  name: string
  tag: string
  tagColor?: string
  placeholder: string
}

const GEO_URL_FIELDS: GeoFieldConfig[] = [
  {
    key: 'geosite',
    name: 'GeoSite 规则文件',
    tag: 'GEOSITE',
    placeholder: 'https://.../geosite.dat',
  },
  {
    key: 'geoip',
    name: 'GeoIP DAT 规则文件',
    tag: 'GEOIP (DAT)',
    placeholder: 'https://.../geoip.dat',
  },
  {
    key: 'asn',
    name: 'ASN 规则文件',
    tag: 'IP-ASN',
    placeholder: 'https://.../GeoLite2-ASN.mmdb',
  },
  {
    key: 'mmdb',
    name: 'GeoIP MMDB 规则文件',
    tag: 'GEOIP (MMDB)',
    placeholder: 'https://.../country.mmdb',
  },
]

export function GeoSettingsPanel({
  value,
  issues,
  onChange,
}: {
  value: GeoSettingsDraft
  issues: VisualIssue[]
  onChange: (value: GeoSettingsDraft) => void
}) {
  const [expanded, setExpanded] = useState(true)

  const update = (patch: Partial<GeoSettingsDraft>) => onChange({ ...value, ...patch, geoxUrl: { ...value.geoxUrl } })

  const updateUrl = (key: GeoUrlKey, url: string | null) => {
    onChange({
      ...value,
      geoxUrl: {
        ...value.geoxUrl,
        [key]: url === '' ? null : url,
      },
    })
  }

  const applyPreset = (presetFn: () => GeoSettingsDraft, label: string) => {
    onChange(presetFn())
    toast.success(`已应用 ${label}`)
  }

  const applyUrlPreset = (presetFn: () => GeoSettingsDraft, label: string) => {
    onChange({ ...value, geoxUrl: { ...presetFn().geoxUrl } })
    toast.success(`已应用 ${label}`)
  }

  const applyGhProxy = () => {
    const geoxUrl = applyGhProxyToGeoUrls(value.geoxUrl)
    const changed = Object.keys(geoxUrl).some(
      (key) => geoxUrl[key as GeoUrlKey] !== value.geoxUrl[key as GeoUrlKey],
    )

    if (!changed) {
      toast.info('没有可替换的 GitHub 地址')
      return
    }

    onChange({ ...value, geoxUrl })
    toast.success('已使用 gh-proxy 替换 GitHub 地址')
  }

  const activePreset = detectActivePreset(value)
  const mode = value.geodataMode === true ? 'dat' : 'mmdb'
  const isAutoUpdate = value.geoAutoUpdate === true
  const intervalIssue = issues.find((issue) => issue.geoField === 'geo-update-interval' && issue.level === 'error')

  const hasAnyCustomValue =
    value.geodataMode != null ||
    value.geoAutoUpdate != null ||
    value.geoUpdateInterval != null ||
    Object.values(value.geoxUrl).some(Boolean)

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
              <Globe className="size-4 text-primary" />
              <strong>GEO 规则数据源</strong>
            </div>

            {/* 状态徽标组 */}
            <div className="template-geo-badges hidden sm:flex items-center gap-1.5 ml-1">
              {activePreset === 'metacubex-full' && <Badge variant="default">MetaCubeX 全量</Badge>}
              {activePreset === 'metacubex-full-domestic' && <Badge variant="default">MetaCubeX 国内直连</Badge>}
              {activePreset === 'metacubex-lite' && <Badge variant="default">MetaCubeX Lite</Badge>}
              {activePreset === 'metacubex-lite-domestic' && <Badge variant="default">MetaCubeX Lite 国内直连</Badge>}
              {activePreset === 'loyalsoldier' && <Badge variant="default">Loyalsoldier</Badge>}
              {activePreset === 'loyalsoldier-domestic' && <Badge variant="default">Loyalsoldier 国内直连</Badge>}
              {activePreset === 'custom' && <Badge variant="outline">自定义源</Badge>}
            </div>
          </div>

          {/* 右侧工具栏操作 */}
          <div className="template-visual-card-actions" onClick={(e) => e.stopPropagation()}>
            {hasAnyCustomValue && (
              <IconButton
                label="清除 GEO 自定义配置"
                onClick={(e) => {
                  e.stopPropagation()
                  applyPreset(createEmptyGeoSettings, '默认内核配置')
                }}
              >
                <Trash2 />
              </IconButton>
            )}
          </div>
        </header>

        {/* 卡片主体（展开时可见） */}
        {expanded && (
          <div className="template-geo-body p-4 pt-3.5 flex flex-col gap-4 border-t border-border">
            {/* 顶栏设置项：运行模式与自动更新 */}
            <div className="flex flex-col gap-3.5">
              {/* 第一行：数据格式选择 */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-h-9">
                <FieldLabel className="mb-0">GEOIP 匹配数据格式 (geodata-mode)</FieldLabel>
                <Segmented
                  value={mode}
                  options={[
                    { value: 'dat', label: 'DAT 格式' },
                    { value: 'mmdb', label: 'MMDB 格式 (默认)' },
                  ]}
                  onChange={(val) =>
                    update({
                      geodataMode: val === 'dat',
                    })
                  }
                  className="w-full sm:w-auto shrink-0"
                />
              </div>

              <div className="h-px bg-border/60" />

              {/* 第二行：自动更新设置（单行内联与平滑过渡） */}
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-h-9">
                  <FieldLabel htmlFor="geo-auto-update-switch" className="mb-0">
                    自动更新规则数据 (geo-auto-update)
                  </FieldLabel>
                  <div className="flex items-center gap-3 self-start sm:self-auto shrink-0">
                    {isAutoUpdate && (
                      <div className="flex items-center gap-2 animate-in fade-in-0 slide-in-from-right-1 duration-150">
                        <span className="text-sm text-muted-foreground whitespace-nowrap">间隔:</span>
                        <Input
                          id="geo-update-interval"
                          type="number"
                          step="1"
                          min="1"
                          placeholder="24"
                          value={value.geoUpdateInterval ?? ''}
                          data-invalid={Boolean(intervalIssue)}
                          className="h-8 text-sm w-20 px-2"
                          onChange={(e) =>
                            update({
                              geoUpdateInterval: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                        />
                        <span className="text-sm text-muted-foreground shrink-0">小时</span>
                      </div>
                    )}
                    <Switch
                      id="geo-auto-update-switch"
                      checked={isAutoUpdate}
                      onCheckedChange={(checked) =>
                        update({
                          geoAutoUpdate: checked,
                          geoUpdateInterval: checked ? (value.geoUpdateInterval ?? 24) : value.geoUpdateInterval,
                        })
                      }
                    />
                  </div>
                </div>
                {intervalIssue && (
                  <FieldError
                    errors={[intervalIssue]}
                    className="text-right text-xs animate-in fade-in-0 duration-150"
                  />
                )}
              </div>
            </div>

            <div className="h-px bg-border/60" />

            {/* 下载地址列表 */}
            <div className="flex flex-col gap-3 pt-0.5">
              <div className="flex items-center justify-between gap-2 flex-wrap min-h-8">
                <div className="flex items-center gap-2">
                  <Database className="size-4 text-muted-foreground" />
                  <span className="text-sm font-semibold text-foreground">数据文件下载地址 (geox-url)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 gap-1.5 text-xs font-medium border-border/80 hover:bg-accent/60"
                    onClick={applyGhProxy}
                  >
                    <Replace className="size-3.5 shrink-0" />
                    <span>使用 gh-proxy</span>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-2.5 gap-1.5 text-xs font-medium border-border/80 hover:bg-accent/60"
                      >
                        <Sparkles className="size-3.5 text-amber-500 shrink-0" />
                        <span>填入预设</span>
                        <ChevronDown className="size-3 text-muted-foreground/70 -mr-0.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-60">
                      <DropdownMenuLabel>推荐下载地址</DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() => applyUrlPreset(createRecommendedGeoSettings, 'MetaCubeX 全量推荐')}
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-sm">MetaCubeX 全量 (推荐)</span>
                          <span className="text-xs text-muted-foreground">完整域名/IP 数据库</span>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => applyUrlPreset(createLiteGeoSettings, 'MetaCubeX 精简版 (Lite)')}
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-sm">MetaCubeX 精简 (Lite)</span>
                          <span className="text-xs text-muted-foreground">精简体积 · 内存占用更低</span>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => applyUrlPreset(createLoyalsoldierGeoSettings, 'Loyalsoldier 规则集')}
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-sm">Loyalsoldier 规则集</span>
                          <span className="text-xs text-muted-foreground">经典社区 V2Ray 规则库</span>
                        </div>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <FieldGroup className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {GEO_URL_FIELDS.map((item) => {
                  const urlValue = value.geoxUrl[item.key] ?? ''
                  const fieldIssue = issues.find((issue) => issue.geoField === item.key && issue.level === 'error')

                  return (
                    <Field
                      key={item.key}
                      data-invalid={Boolean(fieldIssue)}
                      className="template-geo-url-field p-3.5 rounded-lg border border-border bg-card/60 gap-2"
                    >
                      <div className="flex items-center justify-between gap-2 min-h-5">
                        <FieldLabel htmlFor={`geo-url-${item.key}`} className="text-sm font-medium mb-0">
                          {item.name}
                        </FieldLabel>
                        <Badge variant="outline" className="text-xs px-2 py-0.5 font-mono">
                          {item.tag}
                        </Badge>
                      </div>

                      <div className="relative flex items-center">
                        <Input
                          id={`geo-url-${item.key}`}
                          type="url"
                          value={urlValue}
                          placeholder={item.placeholder}
                          data-invalid={Boolean(fieldIssue)}
                          className={cn(
                            'h-9 text-sm font-mono pr-8 bg-background',
                            urlValue ? 'text-foreground' : 'text-muted-foreground',
                          )}
                          onChange={(e) => updateUrl(item.key, e.target.value)}
                        />
                        {urlValue && (
                          <button
                            type="button"
                            onClick={() => updateUrl(item.key, null)}
                            className="absolute right-2 size-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted opacity-70 hover:opacity-100 transition-opacity"
                            title="清空此地址"
                          >
                            <X className="size-3.5" />
                          </button>
                        )}
                      </div>

                      {fieldIssue && (
                        <FieldError errors={[fieldIssue]} className="text-xs animate-in fade-in-0 duration-150" />
                      )}
                    </Field>
                  )
                })}
              </FieldGroup>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
