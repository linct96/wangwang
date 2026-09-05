import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useForm } from '@tanstack/react-form'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { ArrowLeft, CheckCircle2, Layers, PanelRightOpen, RefreshCw, Zap } from 'lucide-react'
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
  TemplateDetail,
  TemplateId,
  TemplateSummary,
} from '@/api/types'
import { AppConfirmDialog, IconButton, PageState } from '@/components/app-primitives'
import { TagCombobox } from '@/components/tag-combobox'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
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
import { SlotBindingEditor } from './slot-binding-editor'
import { ProfilePreviewPanel } from './profile-preview-panel'
import { useProfilePreview } from './use-profile-preview'
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
  const [activeSlotKey, setActiveSlotKey] = useState<string>('')
  const [mobileTab, setMobileTab] = useState<'form' | 'preview'>('form')
  const [previewCollapsed, setPreviewCollapsed] = useState(false)

  const [templateDetail, setTemplateDetail] = useState<TemplateDetail>()
  const [templateDetailLoading, setTemplateDetailLoading] = useState(false)
  const templateDetailsCache = useRef(new Map<string, TemplateDetail>())
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
        name: z.string().trim().min(1, '请输入配置名称').max(60, '名称不能超过 60 个字符'),
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
          .min(1, '模板必须包含至少一个动态节点槽'),
        templateId: z.custom<TemplateId>(
          (value) => typeof value === 'string' && value.length > 0,
          '请选择订阅规则模板',
        ),
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
          toast.success(id ? '配置已更新并重新生成' : '配置创建并生成成功')
        } catch (reason) {
          toast.error(`配置已保存，但生成过程遇到异常：${reason instanceof Error ? reason.message : '未知错误'}`)
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
      templates.find(({ id: templateId }) => templateId === 'builtin:minimal') ||
      templates[0]

    const initialBindings = profile ? profile.slotBindings : emptyBindings(selectedTemplate)
    if (initialBindings.length > 0 && !activeSlotKey) {
      setActiveSlotKey(initialBindings[0].slotKey)
    }

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
            slotBindings: initialBindings,
          },
    )
  }, [form, id, initialTemplateId, profile, templates, activeSlotKey])

  useEffect(() => {
    const currentId = form.state.values.templateId
    if (!currentId) return
    if (templateDetailsCache.current.has(currentId)) {
      setTemplateDetail(templateDetailsCache.current.get(currentId))
      return
    }
    const controller = new AbortController()
    setTemplateDetailLoading(true)
    void api<TemplateDetail>(`/templates/${currentId}`, { signal: controller.signal })
      .then((detail) => {
        if (!controller.signal.aborted) {
          templateDetailsCache.current.set(currentId, detail)
          setTemplateDetail(detail)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setTemplateDetailLoading(false)
      })
    return () => controller.abort()
  }, [form.state.values.templateId])

  const builtin = useMemo(() => templates.filter((template) => template.kind === 'builtin'), [templates])
  const custom = useMemo(() => templates.filter((template) => template.kind === 'custom'), [templates])
  const loading = profileLoading || templatesLoading || sourcesLoading || tagsLoading || nodesLoading
  const loadError = profileError || templateError || sourceError || tagError || nodesError
  const backTo = id ? '/profiles/$id' : '/profiles'

  function applyTemplate(templateId: TemplateId) {
    const previous = new Map(form.state.values.slotBindings.map((binding) => [binding.slotKey, binding]))
    const template = templates.find(({ id: currentId }) => currentId === templateId)
    const newBindings =
      template?.sourceSlots.map(
        ({ key }) =>
          previous.get(key) || {
            slotKey: key,
            mode: 'source' as const,
            sourceIds: [],
            includeRegex: null,
            excludeRegex: null,
          },
      ) || []

    form.setFieldValue('templateId', templateId)
    form.setFieldValue('slotBindings', newBindings)
    if (newBindings.length > 0) {
      setActiveSlotKey(newBindings[0].slotKey)
    }
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
          <IconButton label="返回" onClick={() => void navigate({ to: backTo, params: id ? { id } : undefined })}>
            <ArrowLeft className="size-4" />
          </IconButton>
          <div>
            <h1>{id ? '编辑配置' : '新建订阅配置'}</h1>
            <p>组合节点源与模板规则，右侧实时预览代理组拓扑与节点分流结果</p>
          </div>
        </div>
      </div>

      <PageState loading={loading} error={loadError} />

      {!loading && !loadError && (
        <form onSubmit={submit} noValidate>
          <div className="profile-editor-mobile-switcher">
            <Segmented
              block
              value={mobileTab}
              onChange={(val) => setMobileTab(val as 'form' | 'preview')}
              options={[
                { value: 'form', label: '配置参数' },
                { value: 'preview', label: '实时代理组预览' },
              ]}
            />
          </div>

          <div className={cn('profile-editor-layout', previewCollapsed && 'profile-editor-layout-collapsed')}>
            <main className={cn('profile-editor-main', mobileTab !== 'form' && 'profile-pane-mobile-hidden')}>
              <section className="profile-section">
                <div className="profile-section-header">
                  <div className="flex items-center gap-2">
                    <div className="profile-section-icon">
                      <Zap className="size-4" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-foreground">基础属性</h2>
                      <p className="text-xs text-muted-foreground">
                        {id ? '设置订阅名称、套用规则模板与全局节点标签过滤' : '设置订阅名称与套用规则模板'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="profile-section-body">
                  <FieldGroup className="gap-5">
                    <form.Field name="name">
                      {(field) => {
                        const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                        return (
                          <Field data-invalid={invalid}>
                            <FieldLabel htmlFor="profile-name" className="text-sm font-medium">
                              配置名称 <span className="text-destructive">*</span>
                            </FieldLabel>
                            <Input
                              id="profile-name"
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(event) => field.handleChange(event.target.value)}
                              placeholder="例如：日常主力聚合 / 极速游戏专线"
                              aria-invalid={invalid}
                            />
                            {invalid && <FieldError errors={field.state.meta.errors} />}
                          </Field>
                        )
                      }}
                    </form.Field>

                    <form.Field name="templateId">
                      {(field) => {
                        return (
                          <Field>
                            <FieldLabel htmlFor="profile-template" className="text-sm font-medium">
                              规则模板 <span className="text-destructive">*</span>
                            </FieldLabel>
                            <Select
                              value={field.state.value}
                              onValueChange={(value) => requestTemplateChange(value as TemplateId)}
                            >
                              <SelectTrigger id="profile-template" className="w-full">
                                <SelectValue placeholder="选择规则模板" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  <SelectLabel>内置预设模板</SelectLabel>
                                  {builtin.map((template) => (
                                    <SelectItem key={template.id} value={template.id}>
                                      {template.name}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                                {custom.length > 0 && (
                                  <SelectGroup>
                                    <SelectLabel>我的自定义模板</SelectLabel>
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
                        )
                      }}
                    </form.Field>

                    {id && (
                      <form.Field name="tags">
                        {(field) => {
                          const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                          return (
                            <Field data-invalid={invalid}>
                              <FieldLabel htmlFor="profile-tags" className="text-sm font-medium">
                                节点标签过滤
                              </FieldLabel>
                              <TagCombobox
                                id="profile-tags"
                                value={field.state.value}
                                options={tagOptions}
                                max={20}
                                allowCreate={false}
                                placeholder="选择标签进行全局筛选；留空表示不过滤"
                                invalid={invalid}
                                onBlur={field.handleBlur}
                                onChange={field.handleChange}
                              />
                              <FieldDescription className="text-xs">
                                若设置了标签，仅带有相应标签的节点才会参与分流处理。
                              </FieldDescription>
                              {invalid && <FieldError errors={field.state.meta.errors} />}
                            </Field>
                          )
                        }}
                      </form.Field>
                    )}
                  </FieldGroup>
                </div>
              </section>

              <section className="profile-section">
                <form.Field name="slotBindings">
                  {(field) => {
                    const currentTemplate = templates.find(
                      ({ id: templateId }) => templateId === form.state.values.templateId,
                    )
                    const slots = currentTemplate?.sourceSlots || []
                    const builtinTemplate = currentTemplate?.kind === 'builtin'
                    const effectiveActiveKey = slots.some((s) => s.key === activeSlotKey)
                      ? activeSlotKey
                      : slots[0]?.key || ''

                    return (
                      <div className="flex flex-col gap-0">
                        <div className="profile-section-header">
                          <div className="flex items-center justify-between w-full">
                            <div className="flex items-center gap-2">
                              <div className="profile-section-icon">
                                <Layers className="size-4" />
                              </div>
                              <div>
                                <h2 className="text-base font-semibold text-foreground">
                                  {builtinTemplate ? '节点选择' : '节点分流与槽位绑定'}
                                </h2>
                                <p className="text-xs text-muted-foreground">
                                  {builtinTemplate
                                    ? '选择加入配置的节点源或特定固定节点'
                                    : '为模板定义的各节点槽位配置接入节点源或特定固定节点'}
                                </p>
                              </div>
                            </div>
                            {!builtinTemplate && (
                              <Badge variant="outline" className="text-xs hidden sm:inline-flex">
                                共 {slots.length} 个槽位
                              </Badge>
                            )}
                          </div>
                        </div>

                        {slots.length > 1 && (
                          <div className="slot-tabs-bar">
                            {slots.map((slot, index) => {
                              const binding = field.state.value.find(({ slotKey }) => slotKey === slot.key)
                              const isConfigured = binding ? hasConfiguration(binding) : false
                              const isActive = slot.key === effectiveActiveKey

                              return (
                                <button
                                  key={slot.key}
                                  type="button"
                                  onClick={() => setActiveSlotKey(slot.key)}
                                  className={cn('slot-tab-btn', isActive && 'slot-tab-btn-active')}
                                >
                                  <span className="slot-tab-index">{index + 1}</span>
                                  <span className="slot-tab-name truncate">{slot.name}</span>
                                  {binding && (
                                    <span className="slot-tab-badge">
                                      {binding.mode === 'node'
                                        ? `${binding.nodeIds.length} 节点`
                                        : `${binding.sourceIds.length} 源`}
                                    </span>
                                  )}
                                  {isConfigured && <CheckCircle2 className="size-3 text-emerald-500 shrink-0 ml-0.5" />}
                                </button>
                              )
                            })}
                          </div>
                        )}

                        <div className="profile-section-body">
                          {slots.map((slot) => {
                            if (slots.length > 1 && slot.key !== effectiveActiveKey) return null
                            const binding = field.state.value.find(({ slotKey }) => slotKey === slot.key)
                            if (!binding) return null

                            return (
                              <div key={slot.key} className="space-y-4">
                                {!builtinTemplate && (
                                  <div className="flex items-center justify-between pb-2 border-b">
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold text-sm text-foreground">
                                        当前槽位：{slot.name}
                                      </span>
                                      <Badge variant="secondary" className="text-xs">
                                        槽位标识: {slot.key}
                                      </Badge>
                                    </div>
                                  </div>
                                )}

                                <SlotBindingEditor
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
                              </div>
                            )
                          })}

                          {!field.state.meta.isValid && (
                            <div className="pt-3">
                              <FieldError errors={field.state.meta.errors} />
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  }}
                </form.Field>
              </section>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </main>

            <aside
              className={cn(
                'profile-editor-aside',
                previewCollapsed && 'profile-editor-aside-collapsed',
                mobileTab !== 'preview' && 'profile-pane-mobile-hidden',
              )}
            >
              <form.Subscribe selector={(state) => [state.values.slotBindings, state.values.templateId] as const}>
                {([slotBindings, templateId]) => {
                  const currentTemplate = templates.find((t) => t.id === templateId)
                  return (
                    <LivePreviewWrapper
                      templateDetail={templateDetail}
                      templateDetailLoading={templateDetailLoading}
                      templateName={currentTemplate?.name}
                      slotBindings={slotBindings}
                      nodes={nodes}
                      onToggleCollapse={() => setPreviewCollapsed((prev) => !prev)}
                    />
                  )
                }}
              </form.Subscribe>
            </aside>
          </div>

          <div className="profile-sticky-footer">
            <div className="profile-sticky-footer-inner">
              <form.Subscribe selector={(state) => [state.values, state.isSubmitting, state.canSubmit] as const}>
                {([values, isSubmitting, canSubmit]) => {
                  const currentTemplate = templates.find((t) => t.id === values.templateId)
                  const configuredCount = values.slotBindings.filter(hasConfiguration).length
                  const totalSlots = currentTemplate?.sourceSlots.length || 0

                  const unavailable = values.slotBindings.some(
                    (binding) =>
                      binding.mode === 'node' &&
                      binding.nodeIds.some((nodeId) => {
                        const node = nodes.find(({ id: currentId }) => currentId === nodeId)
                        return !node || !node.enabled || !node.sourceEnabled
                      }),
                  )

                  return (
                    <>
                      <div className="profile-footer-status">
                        <span className="profile-footer-status-title font-medium truncate">
                          {values.name || '未命名配置'}
                        </span>
                        <span className="text-muted-foreground hidden sm:inline">·</span>
                        <span className="text-muted-foreground text-xs hidden sm:inline">
                          模板：{currentTemplate?.name || '未知'}
                        </span>
                        <span className="text-muted-foreground hidden sm:inline">·</span>
                        <span className="text-xs text-muted-foreground hidden md:inline">
                          {currentTemplate?.kind === 'builtin'
                            ? configuredCount
                              ? '节点来源已配置'
                              : '节点来源未配置'
                            : `槽位已配：${configuredCount} / ${totalSlots}`}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={phase !== 'idle'}
                          onClick={() => void navigate({ to: backTo, params: id ? { id } : undefined })}
                          className="h-9 px-4"
                        >
                          取消
                        </Button>

                        <Button
                          disabled={Boolean(isSubmitting) || !canSubmit || unavailable || phase !== 'idle'}
                          className="h-9 px-5 font-medium shadow-sm"
                        >
                          {phase !== 'idle' && <RefreshCw data-icon="inline-start" className="spin size-4" />}
                          {phase === 'generating'
                            ? '正在生成配置...'
                            : phase === 'saving'
                              ? id
                                ? '正在保存...'
                                : '正在创建...'
                              : id
                                ? '保存并生成'
                                : '创建并生成'}
                        </Button>
                      </div>
                    </>
                  )
                }}
              </form.Subscribe>
            </div>
          </div>
        </form>
      )}

      {pendingTemplate && (
        <AppConfirmDialog
          title="更换模板确认"
          description="更换模板将移除在新模板中不存在的动态节点槽配置："
          confirmLabel="确认更换模板"
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

function LivePreviewWrapper({
  templateDetail,
  templateDetailLoading,
  templateName,
  slotBindings,
  nodes,
  onToggleCollapse,
}: {
  templateDetail: TemplateDetail | undefined
  templateDetailLoading: boolean
  templateName: string | undefined
  slotBindings: ProfileSlotBinding[]
  nodes: NodeOption[]
  onToggleCollapse?: () => void
}) {
  const preview = useProfilePreview(templateDetail, slotBindings, nodes)

  return (
    <>
      <button
        type="button"
        onClick={onToggleCollapse}
        className="profile-preview-collapsed-bar"
        title="点击展开实时预览面板"
        aria-label="展开实时预览面板"
      >
        <div className="collapsed-bar-header">
          <PanelRightOpen className="size-4 text-primary" />
        </div>
        <div className="collapsed-bar-title">实时预览</div>
        {preview.groups.length > 0 && (
          <div className="collapsed-bar-badge" title={`${preview.groups.length} 个策略组`}>
            {preview.groups.length}
          </div>
        )}
      </button>

      <div className="profile-preview-expanded-wrap">
        <ProfilePreviewPanel
          preview={preview}
          loading={templateDetailLoading}
          templateName={templateName}
          onToggleCollapse={onToggleCollapse}
        />
      </div>
    </>
  )
}
