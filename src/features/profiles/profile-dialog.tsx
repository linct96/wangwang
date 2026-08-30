import { useState } from 'react'
import type { FormEvent } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { RefreshCw } from 'lucide-react'
import { z } from 'zod'
import { api } from '@/api/client'
import { useApi } from '@/api/use-api'
import type { Profile, Source, TemplateId, TemplateSummary } from '@/api/types'
import { AppDialog } from '@/components/app-primitives'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import '@/styles/profile-dialog.css'

const protocols = ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic']

export function ProfileDialog({
  sources,
  profile,
  initialTemplateId,
  onClose,
  onSaved,
}: {
  sources: Source[]
  profile?: Profile
  initialTemplateId?: TemplateId
  onClose: () => void
  onSaved: (jobId: string, profileId: string) => void
}) {
  const [error, setError] = useState('')
  const { data: templates = [], error: templateError } = useApi<TemplateSummary[]>('/templates')
  const form = useForm({
    defaultValues: {
      name: profile?.name || '',
      tags: profile?.tags.join(', ') || '',
      sourceIds: profile?.sourceIds || [],
      protocols: profile?.protocols || [],
      templateId: profile?.templateId || initialTemplateId || ('builtin:minimal' as TemplateId),
    },
    validators: {
      onSubmit: z.object({
        name: z.string().trim().min(1, '请输入名称').max(60, '名称不能超过 60 个字符'),
        tags: z.string().superRefine((value, context) => {
          const tags = value
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean)
          if (tags.length > 20) context.addIssue({ code: 'custom', message: '标签不能超过 20 个' })
          if (tags.some((tag) => tag.length > 24))
            context.addIssue({ code: 'custom', message: '单个标签不能超过 24 个字符' })
        }),
        sourceIds: z.array(z.string()).min(1, '请至少选择一个节点源').max(20, '节点源不能超过 20 个'),
        protocols: z.array(z.string()).max(20),
        templateId: z.custom<TemplateId>((val) => typeof val === 'string' && val.length > 0, '请选择订阅模板'),
      }),
    },
    onSubmit: async ({ value }) => {
      setError('')
      try {
        const result = await api<{ profile: Profile; jobId: string }>(
          profile ? `/profiles/${profile.id}` : '/profiles',
          {
            method: profile ? 'PATCH' : 'POST',
            body: JSON.stringify({
              name: value.name,
              sourceIds: value.sourceIds,
              protocols: value.protocols,
              tags: value.tags
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean),
              templateId: value.templateId,
              enabled: profile?.enabled ?? true,
            }),
          },
        )
        onSaved(result.jobId, result.profile.id)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '保存失败')
      }
    },
  })
  const selectedProtocols = useStore(form.store, (state) => state.values.protocols)
  const builtin = templates.filter((template) => template.kind === 'builtin')
  const custom = templates.filter((template) => template.kind === 'custom')

  function toggle<T>(items: T[], item: T) {
    return items.includes(item) ? items.filter((value) => value !== item) : [...items, item]
  }

  function selectAllSources() {
    form.setFieldValue(
      'sourceIds',
      sources.map((s) => s.id),
    )
  }

  function clearAllSources() {
    form.setFieldValue('sourceIds', [])
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    await form.handleSubmit()
  }

  return (
    <AppDialog title={profile ? '编辑配置' : '新建配置'} onClose={onClose}>
      <form className="form profile-form profile-dialog-scope" onSubmit={submit} noValidate>
        <FieldGroup>
          <form.Field name="name">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="profile-name">配置名称</FieldLabel>
                  <Input
                    id="profile-name"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="例如：日常聚合 / 游戏专线"
                    aria-invalid={invalid}
                  />
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              )
            }}
          </form.Field>

          <form.Field name="templateId">
            {(field) => (
              <Field data-invalid={Boolean(templateError)}>
                <FieldLabel htmlFor="profile-template">订阅模板</FieldLabel>
                <Select value={field.state.value} onValueChange={(value) => field.handleChange(value as TemplateId)}>
                  <SelectTrigger id="profile-template" className="w-full" aria-invalid={Boolean(templateError)}>
                    <SelectValue placeholder="选择订阅规则模板" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>内置模板</SelectLabel>
                      {builtin.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name} {template.description ? `(${template.description})` : ''}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    {custom.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>我的模板</SelectLabel>
                        {custom.map((template) => (
                          <SelectItem key={template.id} value={template.id}>
                            {template.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
                {templateError && <FieldError>{templateError}</FieldError>}
              </Field>
            )}
          </form.Field>

          <form.Field name="sourceIds">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <FieldSet data-invalid={invalid}>
                  <div className="flex items-center justify-between pb-1">
                    <FieldLegend variant="label">
                      选择节点源 ({field.state.value.length}/{sources.length})
                    </FieldLegend>
                    <div className="flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground underline cursor-pointer"
                        onClick={selectAllSources}
                      >
                        全选
                      </button>
                      <span className="text-muted-foreground">·</span>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground underline cursor-pointer"
                        onClick={clearAllSources}
                      >
                        清空
                      </button>
                    </div>
                  </div>
                  <div className="option-grid">
                    {sources.map((source) => (
                      <Field key={source.id} orientation="horizontal" className="cursor-pointer">
                        <Checkbox
                          id={`source-${source.id}`}
                          checked={field.state.value.includes(source.id)}
                          onCheckedChange={() => field.handleChange(toggle(field.state.value, source.id))}
                          aria-invalid={invalid}
                        />
                        <FieldLabel htmlFor={`source-${source.id}`} className="cursor-pointer flex-1 truncate">
                          {source.name}
                        </FieldLabel>
                        <small className="font-mono text-xs">{source.nodeCount} 节点</small>
                      </Field>
                    ))}
                  </div>
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </FieldSet>
              )
            }}
          </form.Field>

          <FieldSet>
            <div className="flex items-center justify-between pb-1">
              <FieldLegend variant="label">协议筛选</FieldLegend>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground underline cursor-pointer"
                  onClick={() => form.setFieldValue('protocols', [...protocols])}
                >
                  全选
                </button>
                <span className="text-muted-foreground">·</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground underline cursor-pointer"
                  onClick={() => form.setFieldValue('protocols', [])}
                >
                  留空 (全部)
                </button>
              </div>
            </div>
            <div className="option-grid protocols">
              {protocols.map((item) => (
                <Field key={item} orientation="horizontal" className="cursor-pointer">
                  <Checkbox
                    id={`protocol-${item}`}
                    checked={selectedProtocols.includes(item)}
                    onCheckedChange={() => form.setFieldValue('protocols', toggle(selectedProtocols, item))}
                  />
                  <FieldLabel htmlFor={`protocol-${item}`} className="cursor-pointer uppercase font-mono text-xs">
                    {item}
                  </FieldLabel>
                </Field>
              ))}
            </div>
            <FieldDescription>未勾选任何协议时默认包含全部协议节点。</FieldDescription>
          </FieldSet>

          <form.Field name="tags">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="profile-tags">标签筛选</FieldLabel>
                  <Input
                    id="profile-tags"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="例如：香港, 日本 (逗号分隔，留空表示不过滤)"
                    aria-invalid={invalid}
                  />
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              )
            }}
          </form.Field>

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
          <form.Subscribe selector={(state) => [state.isSubmitting]}>
            {([isSubmitting]) => (
              <Button disabled={Boolean(isSubmitting) || Boolean(templateError)}>
                {isSubmitting && <RefreshCw data-icon="inline-start" className="spin" />}
                {profile ? '保存并生成' : '创建并生成'}
              </Button>
            )}
          </form.Subscribe>
        </footer>
      </form>
    </AppDialog>
  )
}
