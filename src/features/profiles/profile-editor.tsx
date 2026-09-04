import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useForm } from '@tanstack/react-form'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { api } from '@/api/client'
import { useApi, waitForJob } from '@/api/use-api'
import type {
  NodeOption,
  Profile,
  ProfileSlotBinding,
  Source,
  TagOption,
  TemplateId,
  TemplateSummary,
} from '@/api/types'
import { AppConfirmDialog, IconButton, PageState } from '@/components/app-primitives'
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
import '@/styles/profile-editor.css'

function validRegex(value: string | null) {
  try {
    if (value) new RegExp(value)
    return true
  } catch {
    return false
  }
}

function emptyBindings(template: TemplateSummary | undefined): ProfileSlotBinding[] {
  return (
    template?.sourceSlots.map(({ key }) => ({
      slotKey: key,
      mode: 'source' as const,
      sourceIds: [],
      includeRegex: null,
      excludeRegex: null,
    })) || []
  )
}

function hasConfiguration(binding: ProfileSlotBinding) {
  return binding.mode === 'node'
    ? binding.nodeIds.length > 0
    : binding.sourceIds.length > 0 || Boolean(binding.includeRegex || binding.excludeRegex)
}

export function NewProfilePage() {
  const { templateId } = useSearch({ from: '/app/profiles/new' })
  return <ProfileEditor initialTemplateId={templateId as TemplateId | undefined} />
}

export function EditProfilePage() {
  const { id } = useParams({ from: '/app/profiles/$id/edit' })
  return <ProfileEditor id={id} />
}

function ProfileEditor({ id, initialTemplateId }: { id?: string; initialTemplateId?: TemplateId }) {
  const navigate = useNavigate()
  const {
    data: templates = [],
    error: templateError,
    loading: templatesLoading,
  } = useApi<TemplateSummary[]>('/templates')
  const {
    data: sources = [],
    error: sourceError,
    loading: sourcesLoading,
  } = useApi<Source[]>('/sources?includeSystem=1')
  const { data: tagOptions = [], error: tagError, loading: tagsLoading } = useApi<TagOption[]>('/tags')
  const { data: nodes = [], error: nodesError, loading: nodesLoading } = useApi<NodeOption[]>('/nodes/options')
  const [profile, setProfile] = useState<Profile>()
  const [profileError, setProfileError] = useState('')
  const [profileLoading, setProfileLoading] = useState(Boolean(id))
  const [error, setError] = useState('')
  const [phase, setPhase] = useState<'idle' | 'saving' | 'generating'>('idle')
  const [pendingTemplate, setPendingTemplate] = useState<{ id: TemplateId; lost: string[] }>()
  const initialized = useRef(false)

  const form = useForm({
    defaultValues: {
      name: '',
      tags: [] as string[],
      templateId: 'builtin:minimal' as TemplateId,
      slotBindings: [] as ProfileSlotBinding[],
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
        templateId: z.custom<TemplateId>((value) => typeof value === 'string' && value.length > 0, '请选择订阅模板'),
      }),
    },
    onSubmit: async ({ value }) => {
      setError('')
      setPhase('saving')
      try {
        const result = await api<{ profile: Profile; jobId: string }>(id ? `/profiles/${id}` : '/profiles', {
          method: id ? 'PATCH' : 'POST',
          body: JSON.stringify({
            name: value.name,
            tags: value.tags,
            templateId: value.templateId,
            slotBindings: value.slotBindings.map((binding) =>
              binding.mode === 'source'
                ? binding
                : { slotKey: binding.slotKey, mode: binding.mode, nodeIds: binding.nodeIds },
            ),
            enabled: profile?.enabled ?? true,
          }),
        })
        setPhase('generating')
        try {
          await waitForJob(result.jobId)
          toast.success(id ? '配置已更新' : '配置生成成功')
        } catch (reason) {
          toast.error(`配置已保存，但生成失败：${reason instanceof Error ? reason.message : '未知错误'}`)
        }
        await navigate({ to: '/profiles/$id', params: { id: result.profile.id } })
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '保存失败')
        setPhase('idle')
      }
    },
  })

  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    setProfileLoading(true)
    void api<Profile>(`/profiles/${id}`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) {
          setProfile(value)
          setProfileError('')
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setProfileError(reason instanceof Error ? reason.message : '配置加载失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setProfileLoading(false)
      })
    return () => controller.abort()
  }, [id])

  useEffect(() => {
    if (initialized.current || !templates.length || (id && !profile)) return
    initialized.current = true
    const selectedTemplate =
      templates.find(({ id: templateId }) => templateId === initialTemplateId) ||
      templates.find(({ id: templateId }) => templateId === 'builtin:minimal')
    form.reset(
      profile
        ? {
            name: profile.name,
            tags: profile.tags,
            templateId: profile.templateId,
            slotBindings: profile.slotBindings,
          }
        : {
            name: '',
            tags: [],
            templateId: selectedTemplate?.id || 'builtin:minimal',
            slotBindings: emptyBindings(selectedTemplate),
          },
    )
  }, [form, id, initialTemplateId, profile, templates])

  const builtin = templates.filter((template) => template.kind === 'builtin')
  const custom = templates.filter((template) => template.kind === 'custom')
  const loading = profileLoading || templatesLoading || sourcesLoading || tagsLoading || nodesLoading
  const loadError = profileError || templateError || sourceError || tagError || nodesError
  const backTo = id ? '/profiles/$id' : '/profiles'

  function applyTemplate(templateId: TemplateId) {
    const previous = new Map(form.state.values.slotBindings.map((binding) => [binding.slotKey, binding]))
    const template = templates.find(({ id: currentId }) => currentId === templateId)
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
    setPendingTemplate(undefined)
  }

  function requestTemplateChange(templateId: TemplateId) {
    if (templateId === form.state.values.templateId) return
    const nextKeys = new Set(
      templates.find(({ id: currentId }) => currentId === templateId)?.sourceSlots.map(({ key }) => key),
    )
    const currentTemplate = templates.find(({ id: currentId }) => currentId === form.state.values.templateId)
    const lost = form.state.values.slotBindings.flatMap((binding) => {
      if (nextKeys.has(binding.slotKey) || !hasConfiguration(binding)) return []
      const name = currentTemplate?.sourceSlots.find(({ key }) => key === binding.slotKey)?.name || binding.slotKey
      return [
        `${name}：${binding.mode === 'node' ? `已指定 ${binding.nodeIds.length} 个节点` : `已选择 ${binding.sourceIds.length} 个节点源`}`,
      ]
    })
    if (lost.length) setPendingTemplate({ id: templateId, lost })
    else applyTemplate(templateId)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    await form.handleSubmit()
  }

  return (
    <div className="profile-editor-page">
      <div className="page-heading">
        <div className="title-with-back">
          <IconButton label="返回配置" onClick={() => void navigate({ to: backTo, params: id ? { id } : undefined })}>
            <ArrowLeft />
          </IconButton>
          <div>
            <h1>{id ? '编辑配置' : '新建配置'}</h1>
            <p>设置模板、标签与动态节点槽</p>
          </div>
        </div>
      </div>

      <PageState loading={loading} error={loadError} />
      {!loading && !loadError && (
        <form className="profile-editor-layout" onSubmit={submit} noValidate>
          <main className="profile-editor-main">
            <section className="profile-editor-card">
              <header>
                <h2>基本设置</h2>
                <p>定义配置名称、规则模板和标签筛选。</p>
              </header>
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
                    <Field>
                      <FieldLabel htmlFor="profile-template">规则模板</FieldLabel>
                      <Select
                        value={field.state.value}
                        onValueChange={(value) => requestTemplateChange(value as TemplateId)}
                      >
                        <SelectTrigger id="profile-template" className="w-full">
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
                    </Field>
                  )}
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
              </FieldGroup>
            </section>

            <section className="profile-editor-card">
              <form.Field name="slotBindings">
                {(field) => {
                  const currentTemplate = templates.find(
                    ({ id: templateId }) => templateId === form.state.values.templateId,
                  )
                  return (
                    <Field data-invalid={!field.state.meta.isValid} className="gap-4">
                      <header className="profile-editor-section-heading">
                        <div>
                          <h2>动态节点槽</h2>
                          <p>按节点源动态筛选，或指定并排列固定节点。</p>
                        </div>
                        <Badge variant="secondary">{currentTemplate?.sourceSlots.length || 0} 个槽位</Badge>
                      </header>
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
                              field.handleChange(
                                field.state.value.map((item) => (item.slotKey === slot.key ? next : item)),
                              )
                            }
                          />
                        ) : null
                      })}
                      {!field.state.meta.isValid && <FieldError errors={field.state.meta.errors} />}
                    </Field>
                  )
                }}
              </form.Field>
            </section>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <footer className="profile-editor-actions">
              <Button
                type="button"
                variant="outline"
                disabled={phase !== 'idle'}
                onClick={() => void navigate({ to: backTo, params: id ? { id } : undefined })}
              >
                取消
              </Button>
              <form.Subscribe
                selector={(state) => [state.isSubmitting, state.canSubmit, state.values.slotBindings] as const}
              >
                {([isSubmitting, canSubmit, bindings]) => {
                  const unavailable = bindings.some(
                    (binding) =>
                      binding.mode === 'node' &&
                      binding.nodeIds.some((nodeId) => {
                        const node = nodes.find(({ id: currentId }) => currentId === nodeId)
                        return !node || !node.enabled || !node.sourceEnabled
                      }),
                  )
                  return (
                    <Button disabled={Boolean(isSubmitting) || !canSubmit || unavailable}>
                      {phase !== 'idle' && <RefreshCw data-icon="inline-start" className="spin" />}
                      {phase === 'generating'
                        ? '正在生成...'
                        : phase === 'saving'
                          ? id
                            ? '正在保存...'
                            : '正在创建...'
                          : id
                            ? '保存并生成'
                            : '创建并生成'}
                    </Button>
                  )
                }}
              </form.Subscribe>
            </footer>
          </main>

          <form.Subscribe selector={(state) => state.values}>
            {(values) => {
              const template = templates.find(({ id: templateId }) => templateId === values.templateId)
              return (
                <aside className="profile-editor-sidebar">
                  <h2>配置摘要</h2>
                  <dl>
                    <div>
                      <dt>模板</dt>
                      <dd>{template?.name || '未选择'}</dd>
                    </div>
                    <div>
                      <dt>标签</dt>
                      <dd>{values.tags.length ? values.tags.join(' / ') : '不过滤'}</dd>
                    </div>
                  </dl>
                  <div className="profile-summary-slots">
                    <h3>动态节点槽</h3>
                    {template?.sourceSlots.map((slot) => {
                      const binding = values.slotBindings.find(({ slotKey }) => slotKey === slot.key)
                      return (
                        <div key={slot.key}>
                          <span>{slot.name}</span>
                          <strong>
                            {binding?.mode === 'node'
                              ? `指定节点 · ${binding.nodeIds.length} 个节点`
                              : `按节点源 · ${binding?.sourceIds.length || 0} 个节点源`}
                          </strong>
                        </div>
                      )
                    })}
                  </div>
                </aside>
              )
            }}
          </form.Subscribe>
        </form>
      )}

      {pendingTemplate && (
        <AppConfirmDialog
          title="更换模板"
          description="更换模板将移除以下动态节点槽配置："
          confirmLabel="仍然更换"
          onClose={() => setPendingTemplate(undefined)}
          onConfirm={() => applyTemplate(pendingTemplate.id)}
        >
          <ul className="profile-template-loss-list">
            {pendingTemplate.lost.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </AppConfirmDialog>
      )}
    </div>
  )
}
