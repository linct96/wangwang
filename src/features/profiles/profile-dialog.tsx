import { useState } from 'react'
import type { FormEvent } from 'react'
import { useForm } from '@tanstack/react-form'
import { RefreshCw } from 'lucide-react'
import { z } from 'zod'
import { api } from '@/api/client'
import { useApi } from '@/api/use-api'
import type { Profile, Source, TemplateId, TemplateSummary } from '@/api/types'
import { AppDialog } from '@/components/app-primitives'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
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
import { cn } from '@/lib/utils'
import '@/styles/profile-dialog.css'

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
                <Field data-invalid={invalid} className="gap-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FieldLabel>包含节点源</FieldLabel>
                      <Badge variant="secondary" className="text-xs font-normal">
                        已选 {field.state.value.length} / {sources.length}
                      </Badge>
                    </div>
                    {sources.length > 0 && (
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="text-xs text-muted-foreground hover:text-foreground h-6 px-1.5"
                          onClick={selectAllSources}
                        >
                          全选
                        </Button>
                        <span className="text-muted-foreground text-xs">/</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="text-xs text-muted-foreground hover:text-foreground h-6 px-1.5"
                          onClick={clearAllSources}
                        >
                          清空
                        </Button>
                      </div>
                    )}
                  </div>

                  {sources.length === 0 ? (
                    <div className="text-xs text-muted-foreground py-6 text-center border border-dashed rounded-lg">
                      暂无可用节点源，请先添加节点源
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-0.5">
                      {sources.map((source) => {
                        const checked = field.state.value.includes(source.id)
                        return (
                          <label
                            key={source.id}
                            htmlFor={`source-${source.id}`}
                            className={cn(
                              'flex items-center justify-between gap-2.5 p-2.5 rounded-lg border text-sm cursor-pointer transition-all select-none',
                              checked
                                ? 'border-primary/40 bg-primary/5 shadow-xs dark:bg-primary/10'
                                : 'border-border/70 hover:border-border hover:bg-muted/40',
                            )}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Checkbox
                                id={`source-${source.id}`}
                                checked={checked}
                                onCheckedChange={() => field.handleChange(toggle(field.state.value, source.id))}
                                aria-invalid={invalid}
                              />
                              <span className="truncate font-medium text-xs sm:text-sm">{source.name}</span>
                            </div>
                            <Badge
                              variant="outline"
                              className="text-[11px] font-mono shrink-0 px-1.5 py-0 h-4.5 text-muted-foreground font-normal"
                            >
                              {source.nodeCount} 节点
                            </Badge>
                          </label>
                        )
                      })}
                    </div>
                  )}
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              )
            }}
          </form.Field>

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
