import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useForm } from '@tanstack/react-form'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { ArrowLeft, CheckCircle2, ChevronDown, Globe, PanelRightOpen, Plug, RefreshCw, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { api } from '@/api/client'
import { useApi, waitForJob } from '@/api/use-api'
import type {
  NodeOption,
  Profile,
  ProfileNodeBinding,
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
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
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

const NODE_BINDING_EDITOR_SCOPE = { key: 'profile-node-binding', name: '全部节点' }

function emptyNodeBinding(): ProfileNodeBinding {
  return { mode: 'source', sourceIds: [], includeRegex: null, excludeRegex: null }
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

function hasConfiguration(binding: ProfileNodeBinding) {
  if (binding.mode === 'node') return binding.nodeIds.length > 0
  if (binding.mode === 'tag') return binding.tags.length > 0
  return binding.sourceIds.length > 0 || Boolean(binding.includeRegex || binding.excludeRegex)
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
  const [collapsedSlotKeys, setCollapsedSlotKeys] = useState<Record<string, boolean>>({})
  const [mobileTab, setMobileTab] = useState<'form' | 'preview'>('form')
  const [previewCollapsed, setPreviewCollapsed] = useState(false)
  const [formMounted, setFormMounted] = useState(false)

  const [basicExpanded, setBasicExpanded] = useState(true)
  const [nodesExpanded, setNodesExpanded] = useState(true)

  const [templateDetail, setTemplateDetail] = useState<TemplateDetail>()
  const [templateDetailLoading, setTemplateDetailLoading] = useState(false)
  const templateDetailsCache = useRef(new Map<string, TemplateDetail>())
  const initialized = useRef(false)

  const form = useForm({
    defaultValues: {
      name: '',
      tags: [] as string[],
      templateId: initialTemplateId || ('builtin:minimal' as TemplateId),
      nodeBinding: emptyNodeBinding(),
      slotBindings: [] as ProfileSlotBinding[],
    },
    validators: {
      onSubmit: z.object({
        name: z.string().trim().min(1, '请输入配置名称').max(60, '名称不能超过 60 个字符'),
        tags: z
          .array(z.string().trim().min(1, '标签不能为空').max(24, '单个标签不能超过 24 个字符'))
          .max(20, '标签不能超过 20 个'),
        nodeBinding: z.discriminatedUnion('mode', [
          z.object({
            mode: z.literal('source'),
            sourceIds: z.array(z.string()).min(1, '请至少选择一个节点源'),
            includeRegex: z.string().nullable().refine(validRegex, '节点筛选正则格式无效'),
            excludeRegex: z.string().nullable().refine(validRegex, '节点过滤正则格式无效'),
          }),
          z.object({
            mode: z.literal('node'),
            nodeIds: z.array(z.string()).min(1, '请至少选择一个节点'),
            missingNodeIds: z.array(z.string()),
          }),
          z.object({
            mode: z.literal('tag'),
            tags: z.array(z.string()).min(1, '请至少选择一个节点标签').max(20, '标签不能超过 20 个'),
          }),
        ]),
        slotBindings: z.array(
          z.discriminatedUnion('mode', [
            z.object({
              slotKey: z.string(),
              mode: z.literal('source'),
              sourceIds: z.array(z.string()).min(1, '请至少选择一个节点源'),
              includeRegex: z.string().nullable().refine(validRegex, '节点筛选正则格式无效'),
              excludeRegex: z.string().nullable().refine(validRegex, '节点过滤正则格式无效'),
            }),
            z.object({
              slotKey: z.string(),
              mode: z.literal('node'),
              nodeIds: z.array(z.string()).min(1, '请至少选择一个节点'),
              missingNodeIds: z.array(z.string()),
            }),
            z.object({
              slotKey: z.string(),
              mode: z.literal('tag'),
              tags: z.array(z.string()).min(1, '请至少选择一个节点标签').max(20, '标签不能超过 20 个'),
            }),
          ]),
        ),
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
            nodeBinding:
              value.nodeBinding.mode === 'node'
                ? { mode: value.nodeBinding.mode, nodeIds: value.nodeBinding.nodeIds }
                : value.nodeBinding,
            slotBindings: value.slotBindings.map((binding) =>
              binding.mode === 'node'
                ? { slotKey: binding.slotKey, mode: binding.mode, nodeIds: binding.nodeIds }
                : binding,
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
    if (initialized.current || !formMounted || !templates.length || (id && !profile)) return
    initialized.current = true
    const selectedTemplate =
      templates.find(({ id: templateId }) => templateId === initialTemplateId) ||
      templates.find(({ id: templateId }) => templateId === 'builtin:minimal') ||
      templates[0]

    const initialBindings = profile ? profile.slotBindings : emptyBindings(selectedTemplate)

    form.reset(
      profile
        ? {
            name: profile.name,
            tags: profile.tags,
            templateId: profile.templateId,
            nodeBinding: profile.nodeBinding,
            slotBindings: profile.slotBindings,
          }
        : {
            name: '',
            tags: [],
            templateId: selectedTemplate?.id || 'builtin:minimal',
            nodeBinding: emptyNodeBinding(),
            slotBindings: initialBindings,
          },
      { keepDefaultValues: true },
    )
  }, [form, id, initialTemplateId, profile, templates, formMounted])

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
    setCollapsedSlotKeys({})
    setPendingTemplate(undefined)
  }

  function requestTemplateChange(templateId: TemplateId) {
    if (!templateId || templateId === form.state.values.templateId) return
    const nextKeys = new Set(
      templates.find(({ id: currentId }) => currentId === templateId)?.sourceSlots.map(({ key }) => key),
    )
    const currentTemplate = templates.find(({ id: currentId }) => currentId === form.state.values.templateId)
    const lost = form.state.values.slotBindings.flatMap((binding) => {
      if (nextKeys.has(binding.slotKey) || !hasConfiguration(binding)) return []
      const name = currentTemplate?.sourceSlots.find(({ key }) => key === binding.slotKey)?.name || binding.slotKey
      return [
        `${name}：${
          binding.mode === 'node'
            ? `已指定 ${binding.nodeIds.length} 个节点`
            : binding.mode === 'tag'
              ? `已选择 ${binding.tags.length} 个节点标签`
              : `已选择 ${binding.sourceIds.length} 个节点源`
        }`,
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
        <form
          ref={(node) => {
            if (node) setFormMounted(true)
          }}
          onSubmit={submit}
          noValidate
        >
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
              {/* 模块 1：基础信息 */}
              <section className="profile-section">
                <form.Subscribe
                  selector={(state) => [state.values.name, state.values.templateId, state.values.tags] as const}
                >
                  {([name, templateId, tags]) => {
                    const selectedTemplate = templates.find((t) => t.id === templateId)
                    return (
                      <>
                        <div className="profile-section-header">
                          <div
                            className="profile-section-header-trigger"
                            role="button"
                            tabIndex={0}
                            onClick={() => setBasicExpanded((prev) => !prev)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                setBasicExpanded((prev) => !prev)
                              }
                            }}
                          >
                            <ChevronDown className={cn('profile-collapse-icon', basicExpanded && 'expanded')} />
                            <div className="flex items-center gap-2">
                              <Zap className="size-4 text-amber-500" />
                              <strong className="text-sm font-semibold text-foreground">基础信息</strong>
                            </div>

                            <div className="profile-section-badges hidden sm:flex items-center gap-1.5 ml-1">
                              {selectedTemplate && (
                                <Badge variant="outline" className="text-xs">
                                  {selectedTemplate.name}
                                </Badge>
                              )}
                              {id && tags && tags.length > 0 && (
                                <Badge variant="secondary" className="text-xs">
                                  {tags.length} 个标签过滤
                                </Badge>
                              )}
                            </div>
                          </div>

                          <div className="profile-section-actions" onClick={(e) => e.stopPropagation()}>
                            {!basicExpanded && name && (
                              <span className="text-xs text-muted-foreground hidden sm:inline truncate max-w-[200px]">
                                {name}
                              </span>
                            )}
                          </div>
                        </div>

                        {basicExpanded && (
                          <div className="profile-section-body p-4 pt-3.5 flex flex-col gap-4 border-t border-border">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                                {(field) => (
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
                                )}
                              </form.Field>
                            </div>

                            {id && (
                              <>
                                <div className="h-px bg-border/60" />
                                <form.Field name="tags">
                                  {(field) => {
                                    const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                                    return (
                                      <Field data-invalid={invalid}>
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                                          <FieldLabel htmlFor="profile-tags" className="text-sm font-medium mb-0">
                                            全局节点标签过滤
                                          </FieldLabel>
                                          <span className="text-xs text-muted-foreground">
                                            若设置，仅带有相应标签的节点才会参与分流处理（留空不过滤）
                                          </span>
                                        </div>
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
                                        {invalid && <FieldError errors={field.state.meta.errors} />}
                                      </Field>
                                    )
                                  }}
                                </form.Field>
                              </>
                            )}
                          </div>
                        )}
                      </>
                    )
                  }}
                </form.Subscribe>
              </section>

              {/* 模块 2：全部节点 */}
              <section className="profile-section">
                <form.Field name="nodeBinding">
                  {(field) => {
                    const binding = field.state.value
                    return (
                      <div className="flex flex-col gap-0">
                        <div className="profile-section-header">
                          <div
                            className="profile-section-header-trigger"
                            role="button"
                            tabIndex={0}
                            onClick={() => setNodesExpanded((prev) => !prev)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                setNodesExpanded((prev) => !prev)
                              }
                            }}
                          >
                            <ChevronDown className={cn('profile-collapse-icon', nodesExpanded && 'expanded')} />
                            <div className="flex items-center gap-2">
                              <Globe className="size-4 text-sky-500" />
                              <strong className="text-sm font-semibold text-foreground">全部节点</strong>
                            </div>

                            <div className="profile-section-badges hidden sm:flex items-center gap-1.5 ml-1">
                              {binding.mode === 'source' ? (
                                <>
                                  <Badge
                                    variant={binding.sourceIds.length > 0 ? 'default' : 'secondary'}
                                    className="text-xs"
                                  >
                                    {binding.sourceIds.length > 0
                                      ? `${binding.sourceIds.length} 个节点源`
                                      : '未选节点源'}
                                  </Badge>
                                  {(binding.includeRegex || binding.excludeRegex) && (
                                    <Badge variant="outline" className="text-xs">
                                      正则已启用
                                    </Badge>
                                  )}
                                </>
                              ) : binding.mode === 'tag' ? (
                                <Badge variant={binding.tags.length > 0 ? 'default' : 'secondary'} className="text-xs">
                                  {binding.tags.length > 0 ? `${binding.tags.length} 个节点标签` : '未选节点标签'}
                                </Badge>
                              ) : (
                                <Badge
                                  variant={binding.nodeIds.length > 0 ? 'default' : 'secondary'}
                                  className="text-xs"
                                >
                                  {binding.nodeIds.length > 0 ? `${binding.nodeIds.length} 个指定节点` : '未选指定节点'}
                                </Badge>
                              )}
                            </div>
                          </div>

                          <div className="profile-section-actions" onClick={(e) => e.stopPropagation()}>
                            <span className="text-xs text-muted-foreground hidden sm:inline">全局默认分流</span>
                          </div>
                        </div>

                        {nodesExpanded && (
                          <div className="profile-section-body p-4 pt-3.5 flex flex-col gap-4 border-t border-border">
                            <SlotBindingEditor
                              slot={NODE_BINDING_EDITOR_SCOPE}
                              value={field.state.value}
                              sources={sources}
                              nodes={nodes}
                              tags={tagOptions}
                              onChange={field.handleChange}
                            />
                            {!field.state.meta.isValid && (
                              <div className="pt-2">
                                <FieldError errors={field.state.meta.errors} />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  }}
                </form.Field>
              </section>

              {/* 模块 3：动态节点槽 */}
              {/* 模块 3：动态节点槽（直接平铺为独立折叠卡片） */}
              <form.Subscribe selector={(state) => [state.values.templateId, state.values.slotBindings] as const}>
                {([templateId]) => {
                  const currentTemplate = templates.find(({ id: currentId }) => currentId === templateId)
                  const slots = currentTemplate?.sourceSlots || []
                  if (slots.length === 0) return null

                  const isSlotExpanded = (key: string) => !collapsedSlotKeys[key]
                  const toggleSlot = (key: string) => setCollapsedSlotKeys((prev) => ({ ...prev, [key]: !prev[key] }))

                  return (
                    <form.Field name="slotBindings">
                      {(field) => (
                        <>
                          {slots.map((slot) => {
                            const binding = field.state.value.find(({ slotKey }) => slotKey === slot.key)
                            if (!binding) return null
                            const isConfigured = hasConfiguration(binding)
                            const isExpanded = isSlotExpanded(slot.key)

                            return (
                              <section key={slot.key} className="profile-section">
                                <div className="profile-section-header">
                                  <div
                                    className="profile-section-header-trigger"
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => toggleSlot(slot.key)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault()
                                        toggleSlot(slot.key)
                                      }
                                    }}
                                  >
                                    <ChevronDown className={cn('profile-collapse-icon', isExpanded && 'expanded')} />
                                    <div className="flex items-center gap-2">
                                      <Plug className="size-4 text-amber-500" />
                                      <strong className="text-sm font-semibold text-foreground">
                                        动态节点槽 · {slot.name}
                                      </strong>
                                    </div>

                                    {binding.mode === 'source' && (binding.includeRegex || binding.excludeRegex) && (
                                      <div className="profile-section-badges hidden sm:flex items-center gap-1.5 ml-1">
                                        <Badge variant="outline" className="text-xs hidden md:inline-flex">
                                          正则已启用
                                        </Badge>
                                      </div>
                                    )}
                                  </div>

                                  <div className="profile-section-actions" onClick={(e) => e.stopPropagation()}>
                                    {isConfigured ? (
                                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                                        <CheckCircle2 className="size-3.5" />
                                        <span className="hidden sm:inline">已配置</span>
                                      </span>
                                    ) : (
                                      <span className="text-xs text-muted-foreground hidden sm:inline">未配置</span>
                                    )}
                                  </div>
                                </div>

                                {isExpanded && (
                                  <div className="profile-section-body p-4 pt-3.5 flex flex-col gap-4 border-t border-border">
                                    <SlotBindingEditor
                                      slot={slot}
                                      value={binding}
                                      sources={sources}
                                      nodes={nodes}
                                      tags={tagOptions}
                                      onChange={(next) =>
                                        field.handleChange(
                                          field.state.value.map((item) =>
                                            item.slotKey === slot.key ? { ...next, slotKey: slot.key } : item,
                                          ),
                                        )
                                      }
                                    />
                                  </div>
                                )}
                              </section>
                            )
                          })}

                          {!field.state.meta.isValid && (
                            <div className="pt-1">
                              <FieldError errors={field.state.meta.errors} />
                            </div>
                          )}
                        </>
                      )}
                    </form.Field>
                  )
                }}
              </form.Subscribe>

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
              <form.Subscribe
                selector={(state) =>
                  [state.values.nodeBinding, state.values.slotBindings, state.values.templateId] as const
                }
              >
                {([nodeBinding, slotBindings, templateId]) => {
                  const currentTemplate = templates.find((t) => t.id === templateId)
                  return (
                    <LivePreviewWrapper
                      templateDetail={templateDetail}
                      templateDetailLoading={templateDetailLoading}
                      templateName={currentTemplate?.name}
                      nodeBinding={nodeBinding}
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

                  const unavailable = [values.nodeBinding, ...values.slotBindings].some(
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
                          {totalSlots > 0
                            ? `全部节点已选 · 槽位已配：${configuredCount} / ${totalSlots}`
                            : '全部节点已选'}
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
  nodeBinding,
  slotBindings,
  nodes,
  onToggleCollapse,
}: {
  templateDetail: TemplateDetail | undefined
  templateDetailLoading: boolean
  templateName: string | undefined
  nodeBinding: ProfileNodeBinding
  slotBindings: ProfileSlotBinding[]
  nodes: NodeOption[]
  onToggleCollapse?: () => void
}) {
  const preview = useProfilePreview(templateDetail, nodeBinding, slotBindings, nodes)

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
