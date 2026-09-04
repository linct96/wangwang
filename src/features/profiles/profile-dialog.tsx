import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useForm } from '@tanstack/react-form'
import { RefreshCw } from 'lucide-react'
import { z } from 'zod'
import { api } from '@/api/client'
import { useApi } from '@/api/use-api'
import type {
  NodeOption,
  Profile,
  ProfileSlotBinding,
  Source,
  TagOption,
  TemplateId,
  TemplateSummary,
} from '@/api/types'
import { AppDialog } from '@/components/app-primitives'
import { TagCombobox } from '@/components/tag-combobox'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
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
import { SlotBindingEditor } from './slot-binding-editor'
import '@/styles/profile-dialog.css'

function validRegex(value: string | null) {
  try {
    if (value) new RegExp(value)
    return true
  } catch {
    return false
  }
}

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
  const { data: tagOptions = [] } = useApi<TagOption[]>('/tags')
  const { data: nodes = [], error: nodesError } = useApi<NodeOption[]>('/nodes/options')
  const form = useForm({
    defaultValues: {
      name: profile?.name || '',
      tags: profile?.tags || ([] as string[]),
      slotBindings: profile?.slotBindings || ([] as ProfileSlotBinding[]),
      templateId: profile?.templateId || initialTemplateId || ('builtin:minimal' as TemplateId),
    },
    validators: {
      onSubmit: z.object({
        name: z.string().trim().min(1, '请输入名称').max(60, '名称不能超过 60 个字符'),
        tags: z
          .array(z.string().trim().min(1, '标签不能为空').max(24, '单个标签不能超过 24 个字符'))
          .max(20, '标签不能超过 20 个'),
        slotBindings: z
          .array(
            z.discriminatedUnion('mode', [
              z.object({
                slotKey: z.string(),
                mode: z.literal('source'),
                sourceIds: z.array(z.string()).min(1, '请至少选择一个节点源'),
                includeRegex: z.string().nullable().refine(validRegex, '包含正则格式无效'),
                excludeRegex: z.string().nullable().refine(validRegex, '排除正则格式无效'),
              }),
              z.object({
                slotKey: z.string(),
                mode: z.literal('node'),
                nodeIds: z.array(z.string()).min(1, '请至少选择一个节点'),
                missingNodeIds: z.array(z.string()),
              }),
            ]),
          )
          .min(1, '模板必须包含动态节点槽'),
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
              slotBindings: value.slotBindings.map((binding) =>
                binding.mode === 'source'
                  ? binding
                  : { slotKey: binding.slotKey, mode: binding.mode, nodeIds: binding.nodeIds },
              ),
              tags: value.tags,
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

  useEffect(() => {
    if (form.state.values.slotBindings.length) return
    const template = templates.find(({ id }) => id === form.state.values.templateId)
    if (template)
      form.setFieldValue(
        'slotBindings',
        template.sourceSlots.map(({ key }) => ({
          slotKey: key,
          mode: 'source' as const,
          sourceIds: [],
          includeRegex: null,
          excludeRegex: null,
        })),
      )
  }, [form, templates])

  function selectTemplate(templateId: TemplateId) {
    const previous = new Map(form.state.values.slotBindings.map((binding) => [binding.slotKey, binding]))
    const template = templates.find(({ id }) => id === templateId)
    form.setFieldValue('templateId', templateId)
    form.setFieldValue(
      'slotBindings',
      template?.sourceSlots.map(
        ({ key }) =>
          previous.get(key) || {
            slotKey: key,
            mode: 'source' as const,
            sourceIds: [],
            includeRegex: null,
            excludeRegex: null,
          },
      ) || [],
    )
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
                <Select value={field.state.value} onValueChange={(value) => selectTemplate(value as TemplateId)}>
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

          <form.Field name="slotBindings">
            {(field) => {
              const currentTemplate = templates.find(({ id }) => id === form.state.values.templateId)
              return (
                <Field data-invalid={!field.state.meta.isValid} className="gap-3">
                  <div className="flex items-center justify-between">
                    <FieldLabel>动态节点槽</FieldLabel>
                    <Badge variant="secondary">{currentTemplate?.sourceSlots.length || 0} 个槽位</Badge>
                  </div>
                  {currentTemplate?.sourceSlots.map((slot) => {
                    const binding = field.state.value.find(({ slotKey }) => slotKey === slot.key)
                    return binding ? (
                      <SlotBindingEditor
                        key={slot.key}
                        slot={slot}
                        value={binding}
                        sources={sources}
                        nodes={nodes}
                        onChange={(next) =>
                          field.handleChange(field.state.value.map((item) => (item.slotKey === slot.key ? next : item)))
                        }
                      />
                    ) : null
                  })}
                  {nodesError && <FieldError>节点列表加载失败：{nodesError}</FieldError>}
                  {!field.state.meta.isValid && <FieldError errors={field.state.meta.errors} />}
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
                  <TagCombobox
                    id="profile-tags"
                    value={field.state.value}
                    options={tagOptions}
                    max={20}
                    allowCreate={false}
                    placeholder="选择节点标签；留空表示不过滤"
                    invalid={invalid}
                    onBlur={field.handleBlur}
                    onChange={field.handleChange}
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
          <form.Subscribe selector={(state) => [state.isSubmitting, state.canSubmit]}>
            {([isSubmitting, canSubmit]) => (
              <Button disabled={Boolean(isSubmitting) || !canSubmit || Boolean(templateError) || Boolean(nodesError)}>
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
