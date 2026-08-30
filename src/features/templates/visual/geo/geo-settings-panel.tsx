import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'
import type { GeoSettingsDraft, VisualIssue } from '../model'
import { createRecommendedGeoSettings } from './presets'
import { inferGeoSource } from '../rules/geo-catalog'

const fields = [
  ['geoip', 'GeoIP DAT', 'geodata-mode 使用 DAT 时用于 GEOIP'],
  ['geosite', 'GeoSite DAT', '用于 GEOSITE 规则'],
  ['mmdb', 'Country MMDB', 'geodata-mode 使用 MMDB 时用于 GEOIP'],
  ['asn', 'ASN MMDB', '用于 IP-ASN / SRC-IP-ASN'],
] as const

export function GeoSettingsPanel({
  value,
  issues,
  onChange,
}: {
  value: GeoSettingsDraft
  issues: VisualIssue[]
  onChange: (value: GeoSettingsDraft) => void
}) {
  const update = (patch: Partial<GeoSettingsDraft>) => onChange({ ...value, ...patch, geoxUrl: { ...value.geoxUrl } })
  const remove = () =>
    onChange({
      geodataMode: null,
      geoAutoUpdate: null,
      geoUpdateInterval: null,
      geoxUrl: { geoip: null, geosite: null, mmdb: null, asn: null },
    })
  const mode = value.geodataMode === true ? 'dat' : value.geodataMode === false ? 'mmdb' : 'default'
  const intervalIssue = issues.find((issue) => issue.geoField === 'geo-update-interval' && issue.level === 'error')
  const modeLabel = mode === 'dat' ? 'DAT' : mode === 'mmdb' ? 'MMDB' : 'Mihomo 默认'
  const updating =
    value.geoAutoUpdate === true ? '自动更新' : value.geoAutoUpdate === false ? '手动更新' : '默认更新策略'
  const custom = inferGeoSource(value, 'GEOSITE').custom || inferGeoSource(value, 'GEOIP').custom
  const restoreUrls = () => onChange({ ...value, geoxUrl: { ...createRecommendedGeoSettings().geoxUrl } })
  return (
    <section className="template-visual-section">
      <header className="template-visual-toolbar">
        <div>
          <h2>GEO 数据</h2>
          <p className="text-xs text-muted-foreground">
            {mode === 'default' && !Object.values(value.geoxUrl).some(Boolean)
              ? '使用 Mihomo 默认配置'
              : `${modeLabel} · ${updating}${value.geoUpdateInterval ? ` · ${value.geoUpdateInterval}h` : ''}${custom ? ' · 自定义数据源' : ''}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => onChange(createRecommendedGeoSettings())}>
            应用推荐配置
          </Button>
          <Button type="button" variant="ghost" onClick={remove}>
            移除 GEO 配置
          </Button>
        </div>
      </header>
      <div className="grid gap-4 p-4">
        <p className="text-sm text-muted-foreground">用于 GEOSITE、GEOIP 和 ASN 规则的数据文件。</p>
        <Field>
          <FieldLabel>GEOIP 数据格式</FieldLabel>
          <div className="flex gap-4 text-sm">
            {(
              [
                ['default', '使用 Mihomo 默认'],
                ['dat', 'DAT'],
                ['mmdb', 'MMDB'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="geo-mode"
                  checked={mode === key}
                  onChange={() => update({ geodataMode: key === 'default' ? null : key === 'dat' })}
                />
                {label}
              </label>
            ))}
          </div>
        </Field>
        <Field>
          <FieldLabel htmlFor="geo-auto-update">自动更新 GEO 数据</FieldLabel>
          <label className="flex items-center gap-2 text-sm">
            <input
              id="geo-auto-update"
              type="checkbox"
              checked={value.geoAutoUpdate === true}
              onChange={(e) => update({ geoAutoUpdate: e.target.checked })}
            />
            开启
          </label>
        </Field>
        <Field>
          <FieldLabel htmlFor="geo-update-interval">更新间隔（小时）</FieldLabel>
          <Input
            id="geo-update-interval"
            type="number"
            step="1"
            min="1"
            value={value.geoUpdateInterval ?? ''}
            onChange={(e) => update({ geoUpdateInterval: e.target.value === '' ? null : Number(e.target.value) })}
          />
          <p className="text-xs text-muted-foreground">关闭自动更新时，开启后生效。</p>
          {intervalIssue && <p className="text-xs text-destructive">{intervalIssue.message}</p>}
        </Field>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">数据下载地址</h3>
          <Button type="button" variant="outline" size="sm" onClick={restoreUrls}>
            恢复推荐值
          </Button>
        </div>
        <div className="grid gap-3">
          {fields.map(([key, label, help]) => (
            <Field key={key}>
              <FieldLabel htmlFor={`geo-${key}`}>{label}</FieldLabel>
              <Input
                id={`geo-${key}`}
                type="url"
                value={value.geoxUrl[key] ?? ''}
                placeholder="使用 Mihomo 默认值"
                onChange={(e) =>
                  onChange({
                    ...value,
                    geoxUrl: { ...value.geoxUrl, [key]: e.target.value === '' ? null : e.target.value },
                  })
                }
              />
              <p className="text-xs text-muted-foreground">{help}</p>
              {issues.find((issue) => issue.geoField === key && issue.level === 'error') && (
                <p className="text-xs text-destructive">{issues.find((issue) => issue.geoField === key)?.message}</p>
              )}
            </Field>
          ))}
        </div>
      </div>
    </section>
  )
}
