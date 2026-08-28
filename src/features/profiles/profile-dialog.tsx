import type { FormEvent } from 'react'
import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, RefreshCw, X } from 'lucide-react'
import { useForm, useStore } from '@tanstack/react-form'
import { api } from '@/api/client'
import type { Profile, RuleModule, Source } from '@/api/types'
import { AppDialog, IconButton } from '@/components/app-primitives'
import { Alert, AlertDescription } from '@/components/ui/alert'
import '@/styles/profile-dialog.css'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const ruleLabels: Record<RuleModule, string> = { ads: '广告拦截', private: '私有网络直连', cn: '中国大陆直连' }
const protocols = ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic']

export function ProfileDialog({
  sources,
  profile,
  onClose,
  onSaved,
}: {
  sources: Source[]
  profile?: Profile
  onClose: () => void
  onSaved: (jobId: string) => void
}) {
  const [error, setError] = useState('')
  const form = useForm({
    defaultValues: {
      name: profile?.name || '',
      tags: profile?.tags.join(', ') || '',
      dnsMode: (profile?.dnsMode || 'fake-ip') as 'fake-ip' | 'redir-host',
      sourceIds: profile?.sourceIds || [],
      protocols: profile?.protocols || [],
      ruleModules: profile?.ruleModules || ['ads', 'private', 'cn'],
    },
    onSubmit: async ({ value }) => {
      setError('')
      try {
        const result = await api<{ jobId: string }>(profile ? `/profiles/${profile.id}` : '/profiles', {
          method: profile ? 'PATCH' : 'POST',
          body: JSON.stringify({
            name: value.name,
            sourceIds: value.sourceIds,
            protocols: value.protocols,
            tags: value.tags
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean),
            dnsMode: value.dnsMode,
            ruleModules: value.ruleModules,
            enabled: profile?.enabled ?? true,
          }),
        })
        onSaved(result.jobId)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '保存失败')
      }
    },
  })
  const sourceIds = useStore(form.store, (state) => state.values.sourceIds)
  const selectedProtocols = useStore(form.store, (state) => state.values.protocols)
  const rules = useStore(form.store, (state) => state.values.ruleModules)
  function toggle<T>(items: T[], item: T) {
    return items.includes(item) ? items.filter((value) => value !== item) : [...items, item]
  }
  function move(index: number, offset: number) {
    const next = [...rules]
    const target = index + offset
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    form.setFieldValue('ruleModules', next)
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    await form.handleSubmit()
  }
  return (
    <AppDialog title={profile ? '编辑配置' : '新建配置'} onClose={onClose}>
      <form className="form profile-form profile-dialog-scope" onSubmit={submit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="profile-name">名称</FieldLabel>
            <form.Field name="name">
              {(field) => (
                <Input
                  id="profile-name"
                  required
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="例如：日常使用"
                />
              )}
            </form.Field>
          </Field>
          <FieldSet>
            <FieldLegend variant="label">节点源</FieldLegend>
            <div className="option-grid">
              {sources.map((source) => (
                <Field key={source.id} orientation="horizontal">
                  <Checkbox
                    id={`source-${source.id}`}
                    checked={sourceIds.includes(source.id)}
                    onCheckedChange={() => form.setFieldValue('sourceIds', toggle(sourceIds, source.id))}
                  />
                  <FieldLabel htmlFor={`source-${source.id}`}>{source.name}</FieldLabel>
                  <small>{source.nodeCount}</small>
                </Field>
              ))}
            </div>
          </FieldSet>
          <FieldSet>
            <FieldLegend variant="label">协议筛选</FieldLegend>
            <div className="option-grid protocols">
              {protocols.map((item) => (
                <Field key={item} orientation="horizontal">
                  <Checkbox
                    id={`protocol-${item}`}
                    checked={selectedProtocols.includes(item)}
                    onCheckedChange={() => form.setFieldValue('protocols', toggle(selectedProtocols, item))}
                  />
                  <FieldLabel htmlFor={`protocol-${item}`}>{item}</FieldLabel>
                </Field>
              ))}
            </div>
          </FieldSet>
          <Field>
            <FieldLabel htmlFor="profile-tags">标签筛选</FieldLabel>
            <form.Field name="tags">
              {(field) => (
                <Input
                  id="profile-tags"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="留空表示全部"
                />
              )}
            </form.Field>
          </Field>
          <FieldSet>
            <FieldLegend variant="label">DNS 模式</FieldLegend>
            <ToggleGroup
              type="single"
              variant="outline"
              value={form.getFieldValue('dnsMode')}
              onValueChange={(value) => value && form.setFieldValue('dnsMode', value as 'fake-ip' | 'redir-host')}
            >
              <ToggleGroupItem value="fake-ip">fake-ip</ToggleGroupItem>
              <ToggleGroupItem value="redir-host">redir-host</ToggleGroupItem>
            </ToggleGroup>
          </FieldSet>
          <FieldSet>
            <FieldLegend variant="label">规则顺序</FieldLegend>
            <div className="rule-list">
              {rules.map((rule, index) => (
                <div key={rule}>
                  <span>{ruleLabels[rule]}</span>
                  <IconButton
                    label="上移"
                    disabled={index === 0}
                    onClick={() => {
                      move(index, -1)
                      form.setFieldValue('ruleModules', [
                        ...rules.slice(0, index - 1),
                        rule,
                        rules[index - 1],
                        ...rules.slice(index + 1),
                      ])
                    }}
                  >
                    <ArrowUp />
                  </IconButton>
                  <IconButton
                    label="下移"
                    disabled={index === rules.length - 1}
                    onClick={() => {
                      move(index, 1)
                      form.setFieldValue('ruleModules', [
                        ...rules.slice(0, index),
                        rules[index + 1],
                        rule,
                        ...rules.slice(index + 2),
                      ])
                    }}
                  >
                    <ArrowDown />
                  </IconButton>
                  <IconButton
                    label="移除"
                    onClick={() =>
                      form.setFieldValue(
                        'ruleModules',
                        rules.filter((item) => item !== rule),
                      )
                    }
                  >
                    <X />
                  </IconButton>
                </div>
              ))}
              {Object.keys(ruleLabels)
                .filter((rule) => !rules.includes(rule as RuleModule))
                .map((rule) => (
                  <Button
                    type="button"
                    variant="outline"
                    key={rule}
                    onClick={() => form.setFieldValue('ruleModules', [...rules, rule as RuleModule])}
                  >
                    <Plus data-icon="inline-start" />
                    {ruleLabels[rule as RuleModule]}
                  </Button>
                ))}
            </div>
          </FieldSet>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </FieldGroup>
        <footer>
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <form.Subscribe selector={(state) => [state.isSubmitting, state.values.sourceIds]}>
            {([isSubmitting, currentSourceIds]) => (
              <Button disabled={Boolean(isSubmitting) || !(Array.isArray(currentSourceIds) && currentSourceIds.length)}>
                {isSubmitting && <RefreshCw data-icon="inline-start" className="spin" />}保存并生成
              </Button>
            )}
          </form.Subscribe>
        </footer>
      </form>
    </AppDialog>
  )
}
