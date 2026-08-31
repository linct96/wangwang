import { useState } from 'react'
import { Plus, Replace, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { AppDialog, IconButton } from '@/components/app-primitives'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { applyGhProxyToGithubUrl } from '../geo/presets'
import { newRuleProvider } from '../yaml-adapter'
import type {
  ProxyGroupDraft,
  RuleProviderBehavior,
  RuleProviderDraft,
  RuleProviderFormat,
  RuleProviderType,
  StructuredRuleProviderDraft,
} from '../model'

function editableProvider(provider: StructuredRuleProviderDraft): StructuredRuleProviderDraft {
  return provider.type === 'inline' ? { ...provider, format: undefined } : provider
}

export function ProviderDialog({
  providers,
  groups,
  value,
  onSave,
  children,
}: {
  providers: RuleProviderDraft[]
  groups: ProxyGroupDraft[]
  value?: StructuredRuleProviderDraft
  onSave: (provider: StructuredRuleProviderDraft) => void
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(() => editableProvider(value || newRuleProvider(providers)))
  const show = () => {
    setForm(editableProvider(value || newRuleProvider(providers)))
    setOpen(true)
  }
  const setType = (type: RuleProviderType) =>
    setForm({
      ...form,
      type,
      format: type === 'inline' ? undefined : form.format || 'mrs',
      url: type === 'http' ? form.url || '' : undefined,
      interval: type === 'http' ? form.interval || 86400 : undefined,
      proxy: type === 'http' ? form.proxy : undefined,
      path: type === 'file' ? form.path || '' : undefined,
      payload: type === 'inline' ? form.payload || [''] : undefined,
    })
  const setBehavior = (behavior: RuleProviderBehavior) => {
    if (behavior === 'classical' && form.format === 'mrs') toast.info('Classical 不支持 MRS，已切换为 YAML')
    setForm({ ...form, behavior, format: behavior === 'classical' && form.format === 'mrs' ? 'yaml' : form.format })
  }
  const applyGhProxy = () => {
    const url = applyGhProxyToGithubUrl(form.url)
    if (url === form.url) {
      toast.info('没有可替换的 GitHub 地址')
      return
    }
    setForm({ ...form, url })
    toast.success('已使用 gh-proxy 替换 GitHub 地址')
  }
  const save = () => {
    const name = form.name.trim()
    if (!name || providers.some((provider) => provider.id !== form.id && provider.name === name)) {
      toast.error('数据源名称不能为空且不能重复')
      return
    }
    if (form.type === 'http') {
      try {
        if (!form.url || !['http:', 'https:'].includes(new URL(form.url).protocol)) throw new Error()
      } catch {
        toast.error('请输入有效的 HTTP 或 HTTPS URL')
        return
      }
    }
    if (form.type === 'file' && !form.path?.trim()) {
      toast.error('文件路径不能为空')
      return
    }
    if (form.type === 'inline' && !form.payload?.some((item) => item.trim())) {
      toast.error('至少添加一条规则内容')
      return
    }
    onSave({
      ...form,
      name,
      payload: form.payload?.map((item) => item.trim()).filter(Boolean),
      header: form.header
        ? Object.fromEntries(Object.entries(form.header).filter(([key, values]) => key.trim() && values.some(Boolean)))
        : undefined,
    })
    setOpen(false)
  }
  const proxyValue =
    form.proxy?.kind === 'group'
      ? `group:${form.proxy.groupId}`
      : form.proxy?.kind === 'builtin'
        ? 'DIRECT'
        : form.proxy?.kind === 'raw'
          ? `raw:${form.proxy.value}`
          : 'none'
  return (
    <>
      <span onClick={show}>{children}</span>
      {open && (
        <AppDialog title={value ? '编辑规则集数据源' : '添加规则集数据源'} onClose={() => setOpen(false)}>
          <FieldGroup className="gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>名称</FieldLabel>
                <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel>类型</FieldLabel>
                <Select value={form.type} onValueChange={(next: RuleProviderType) => setType(next)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="http">HTTP</SelectItem>
                    <SelectItem value="file">FILE</SelectItem>
                    <SelectItem value="inline">INLINE</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>规则行为</FieldLabel>
                <Select value={form.behavior} onValueChange={(next: RuleProviderBehavior) => setBehavior(next)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="domain">DOMAIN</SelectItem>
                    <SelectItem value="ipcidr">IPCIDR</SelectItem>
                    <SelectItem value="classical">CLASSICAL</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {form.type !== 'inline' && (
                <Field>
                  <FieldLabel>文件格式</FieldLabel>
                  <Select
                    value={form.format || 'yaml'}
                    onValueChange={(format: RuleProviderFormat) => setForm({ ...form, format })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mrs" disabled={form.behavior === 'classical'}>
                        MRS
                      </SelectItem>
                      <SelectItem value="yaml">YAML</SelectItem>
                      <SelectItem value="text">TEXT</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </div>

            {form.type === 'http' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field className="sm:col-span-2">
                  <div className="flex items-center justify-between gap-2">
                    <FieldLabel>URL</FieldLabel>
                    <Button type="button" variant="outline" size="xs" onClick={applyGhProxy}>
                      <Replace data-icon="inline-start" />
                      使用 gh-proxy
                    </Button>
                  </div>
                  <Input
                    value={form.url || ''}
                    placeholder="https://example.com/rules.mrs"
                    onChange={(event) => setForm({ ...form, url: event.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel>更新间隔（秒）</FieldLabel>
                  <Input
                    type="number"
                    min={1}
                    value={form.interval ?? 86400}
                    onChange={(event) => setForm({ ...form, interval: Number(event.target.value) })}
                  />
                </Field>
                <Field>
                  <FieldLabel>缓存路径（可选）</FieldLabel>
                  <Input
                    value={form.path || ''}
                    onChange={(event) => setForm({ ...form, path: event.target.value || undefined })}
                  />
                </Field>
                <Field className="sm:col-span-2">
                  <FieldLabel>下载代理（可选）</FieldLabel>
                  <Select
                    value={proxyValue}
                    onValueChange={(next) =>
                      setForm({
                        ...form,
                        proxy:
                          next === 'none'
                            ? undefined
                            : next === 'DIRECT'
                              ? { kind: 'builtin', value: 'DIRECT' }
                              : next.startsWith('group:')
                                ? { kind: 'group', groupId: next.slice(6) }
                                : { kind: 'raw', value: next.slice(4) },
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">不指定</SelectItem>
                      <SelectItem value="DIRECT">DIRECT</SelectItem>
                      {groups.map((group) => (
                        <SelectItem key={group.id} value={`group:${group.id}`}>
                          {group.name}
                        </SelectItem>
                      ))}
                      {form.proxy?.kind === 'raw' && (
                        <SelectItem value={`raw:${form.proxy.value}`}>{form.proxy.value}（高级）</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}

            {form.type === 'file' && (
              <Field>
                <FieldLabel>文件路径</FieldLabel>
                <Input
                  value={form.path || ''}
                  placeholder="./rules/custom.yaml"
                  onChange={(event) => setForm({ ...form, path: event.target.value })}
                />
              </Field>
            )}

            {form.type === 'inline' && (
              <Field>
                <FieldLabel>规则内容</FieldLabel>
                <div className="flex flex-col gap-2">
                  {(form.payload || ['']).map((item, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        value={item}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            payload: (form.payload || ['']).map((value, itemIndex) =>
                              itemIndex === index ? event.target.value : value,
                            ),
                          })
                        }
                      />
                      <IconButton
                        label="删除规则内容"
                        onClick={() =>
                          setForm({
                            ...form,
                            payload: (form.payload || []).filter((_, itemIndex) => itemIndex !== index),
                          })
                        }
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setForm({ ...form, payload: [...(form.payload || []), ''] })}
                  >
                    <Plus data-icon="inline-start" />
                    添加规则
                  </Button>
                </div>
              </Field>
            )}

            <details>
              <summary className="cursor-pointer text-sm font-medium">高级配置</summary>
              <div className="mt-4 flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel>path-in-bundle</FieldLabel>
                    <Input
                      value={form.pathInBundle || ''}
                      onChange={(event) => setForm({ ...form, pathInBundle: event.target.value || undefined })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>size-limit</FieldLabel>
                    <Input
                      type="number"
                      min={1}
                      value={form.sizeLimit ?? ''}
                      onChange={(event) =>
                        setForm({ ...form, sizeLimit: event.target.value ? Number(event.target.value) : undefined })
                      }
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel>HTTP Header</FieldLabel>
                  <div className="flex flex-col gap-2">
                    {Object.entries(form.header || {}).map(([key, values], index) => (
                      <div key={`${key}-${index}`} className="grid grid-cols-[1fr_1.4fr_auto] gap-2">
                        <Input
                          value={key}
                          placeholder="Header"
                          onChange={(event) => {
                            const entries = Object.entries(form.header || {})
                            entries[index] = [event.target.value, values]
                            setForm({ ...form, header: Object.fromEntries(entries) })
                          }}
                        />
                        <Input
                          value={values.join(', ')}
                          placeholder="多个值用逗号分隔"
                          onChange={(event) =>
                            setForm({
                              ...form,
                              header: {
                                ...(form.header || {}),
                                [key]: event.target.value
                                  .split(',')
                                  .map((item) => item.trim())
                                  .filter(Boolean),
                              },
                            })
                          }
                        />
                        <IconButton
                          label="删除 Header"
                          onClick={() =>
                            setForm({
                              ...form,
                              header: Object.fromEntries(
                                Object.entries(form.header || {}).filter((_, itemIndex) => itemIndex !== index),
                              ),
                            })
                          }
                        >
                          <Trash2 />
                        </IconButton>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setForm({
                          ...form,
                          header: {
                            ...(form.header || {}),
                            [`Header-${Object.keys(form.header || {}).length + 1}`]: [''],
                          },
                        })
                      }
                    >
                      <Plus data-icon="inline-start" />
                      添加 Header
                    </Button>
                  </div>
                </Field>
              </div>
            </details>
          </FieldGroup>
          <div className="dialog-actions">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="button" onClick={save}>
              保存
            </Button>
          </div>
        </AppDialog>
      )}
    </>
  )
}
