import { useState } from 'react'
import type { FormEvent } from 'react'
import { RefreshCw } from 'lucide-react'
import { api } from '@/api/client'
import { useApi } from '@/api/use-api'
import type { Profile, Source, TagOption, TemplateId, TemplateSummary } from '@/api/types'
import { AppDialog } from '@/components/app-primitives'
import { TagCombobox } from '@/components/tag-combobox'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
  const [submitting, setSubmitting] = useState(false)
  const { data: templates = [], error: templateError } = useApi<TemplateSummary[]>('/templates')
  const { data: tagOptions = [] } = useApi<TagOption[]>('/tags')

  const [name, setName] = useState(profile?.name || '')
  const [tags, setTags] = useState<string[]>(profile?.tags || [])
  const [templateId, setTemplateId] = useState<TemplateId>(
    profile?.templateId || initialTemplateId || ('builtin:minimal' as TemplateId),
  )

  const [bindings, setBindings] = useState<Record<string, string[]>>(() => {
    if (!profile?.sourceBindings?.length) return {}
    return Object.fromEntries(profile.sourceBindings.map((b) => [b.slotKey, b.sourceIds]))
  })

  const sourceById = new Map(sources.map((s) => [s.id, s]))
  const builtin = templates.filter((template) => template.kind === 'builtin')
  const custom = templates.filter((template) => template.kind === 'custom')

  const currentTemplate = templates.find((t) => t.id === templateId)

  function handleTemplateChange(nextTemplateId: TemplateId) {
    const nextTemplate = templates.find((t) => t.id === nextTemplateId)
    const nextBindings: Record<string, string[]> = {}
    for (const slot of nextTemplate?.sourceSlots || []) {
      nextBindings[slot.key] = bindings[slot.key] || []
    }
    setBindings(nextBindings)
    setTemplateId(nextTemplateId)
  }

  function toggleSlotSource(slotKey: string, sourceId: string) {
    const current = bindings[slotKey] || []
    const next = current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId]
    setBindings({ ...bindings, [slotKey]: next })
  }

  function setSlotSources(slotKey: string, sourceIds: string[]) {
    setBindings({ ...bindings, [slotKey]: sourceIds })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('请输入配置名称')
      return
    }
    if (trimmedName.length > 60) {
      setError('配置名称不能超过 60 个字符')
      return
    }

    if (!currentTemplate) {
      setError('请选择订阅模板')
      return
    }

    if (currentTemplate.migrationStatus === 'needs_repair') {
      setError('所选模板需要先修复槽位才能用于配置')
      return
    }

    for (const slot of currentTemplate.sourceSlots) {
      const boundIds = bindings[slot.key] || []
      const enabledCount = boundIds.filter((id) => sourceById.get(id)?.enabled).length
      if (enabledCount === 0) {
        setError(`节点源槽位“${slot.name}”至少需要绑定一个已启用的节点源`)
        return
      }
    }

    const allUniqueSources = new Set(currentTemplate.sourceSlots.flatMap((slot) => bindings[slot.key] || []))
    if (allUniqueSources.size > 20) {
      setError('配置引用的节点源总数不能超过 20 个')
      return
    }

    const payload = {
      name: trimmedName,
      templateId,
      tags,
      sourceBindings: currentTemplate.sourceSlots.map((slot) => ({
        slotKey: slot.key,
        sourceIds: bindings[slot.key] || [],
      })),
      enabled: profile?.enabled ?? true,
    }

    setSubmitting(true)
    try {
      const result = await api<{ profile: Profile; jobId: string }>(profile ? `/profiles/${profile.id}` : '/profiles', {
        method: profile ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      })
      onSaved(result.jobId, result.profile.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AppDialog title={profile ? '编辑配置' : '新建配置'} onClose={onClose}>
      <form className="form profile-form profile-dialog-scope" onSubmit={submit} noValidate>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="profile-name">配置名称</FieldLabel>
            <Input
              id="profile-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：日常聚合 / 游戏专线"
              maxLength={60}
              required
            />
          </Field>

          <Field data-invalid={Boolean(templateError)}>
            <FieldLabel htmlFor="profile-template">订阅模板</FieldLabel>
            <Select value={templateId} onValueChange={(val) => handleTemplateChange(val as TemplateId)}>
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
                        {template.migrationStatus === 'needs_repair' && ' (待修复)'}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
            {templateError && <FieldError>{templateError}</FieldError>}
          </Field>

          {currentTemplate && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <FieldLabel>节点源槽位绑定</FieldLabel>
                <span className="text-xs text-muted-foreground font-mono">
                  共 {currentTemplate.sourceSlots.length} 个槽位
                </span>
              </div>

              {currentTemplate.sourceSlots.map((slot) => {
                const boundSourceIds = bindings[slot.key] || []
                const enabledCount = boundSourceIds.filter((sid) => sourceById.get(sid)?.enabled).length
                const disabledCount = boundSourceIds.length - enabledCount
                const isSlotValid = enabledCount >= 1

                return (
                  <div
                    key={slot.key}
                    className={cn(
                      'p-3 rounded-lg border flex flex-col gap-2.5 transition-colors',
                      isSlotValid ? 'border-border/70 bg-card/40' : 'border-destructive/40 bg-destructive/5',
                    )}
                  >
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{slot.name}</span>
                        <code className="text-[11px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
                          {slot.key}
                        </code>
                        <Badge variant={isSlotValid ? 'secondary' : 'destructive'} className="text-xs font-normal">
                          已选 {boundSourceIds.length} / {sources.length}
                          {disabledCount > 0 && ` (${disabledCount} 个已停用)`}
                        </Badge>
                      </div>
                      {sources.length > 0 && (
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            className="text-xs text-muted-foreground hover:text-foreground h-6 px-1.5"
                            onClick={() => {
                              const enabledIds = sources.filter((s) => s.enabled).map((s) => s.id)
                              const existingDisabled = (bindings[slot.key] || []).filter(
                                (id) => !sourceById.get(id)?.enabled,
                              )
                              setSlotSources(slot.key, [...new Set([...enabledIds, ...existingDisabled])])
                            }}
                          >
                            全选可用
                          </Button>
                          <span className="text-muted-foreground text-xs">/</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            className="text-xs text-muted-foreground hover:text-foreground h-6 px-1.5"
                            onClick={() => setSlotSources(slot.key, [])}
                          >
                            清空
                          </Button>
                        </div>
                      )}
                    </div>

                    {sources.length === 0 ? (
                      <div className="text-xs text-muted-foreground py-4 text-center border border-dashed rounded-lg">
                        暂无可用节点源，请先添加节点源
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-0.5">
                        {sources.map((source) => {
                          const checked = boundSourceIds.includes(source.id)
                          const canToggle = source.enabled || checked
                          return (
                            <label
                              key={source.id}
                              htmlFor={`source-${slot.key}-${source.id}`}
                              className={cn(
                                'flex items-center justify-between gap-2.5 p-2 rounded-lg border text-sm transition-all select-none',
                                canToggle ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
                                checked
                                  ? 'border-primary/40 bg-primary/5 shadow-xs dark:bg-primary/10'
                                  : 'border-border/70 hover:border-border hover:bg-muted/40',
                                !source.enabled && 'opacity-75',
                              )}
                              title={!canToggle ? '该节点源已停用，无法新选择' : undefined}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <Checkbox
                                  id={`source-${slot.key}-${source.id}`}
                                  checked={checked}
                                  disabled={!canToggle}
                                  onCheckedChange={() => {
                                    if (canToggle) toggleSlotSource(slot.key, source.id)
                                  }}
                                />
                                <span className="truncate font-medium text-xs sm:text-sm">
                                  {source.name}
                                  {!source.enabled && (
                                    <span className="text-destructive text-xs ml-1 font-normal">(已停用)</span>
                                  )}
                                </span>
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
                    {!isSlotValid && (
                      <span className="text-xs text-destructive">该槽位至少需要包含一个已启用的节点源</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <Field>
            <FieldLabel htmlFor="profile-tags">标签筛选</FieldLabel>
            <TagCombobox
              id="profile-tags"
              value={tags}
              options={tagOptions}
              max={20}
              allowCreate={false}
              placeholder="选择节点标签；留空表示不过滤"
              onChange={setTags}
            />
          </Field>

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
          <Button disabled={submitting || Boolean(templateError)}>
            {submitting && <RefreshCw data-icon="inline-start" className="spin" />}
            {profile ? '保存并生成' : '创建并生成'}
          </Button>
        </footer>
      </form>
    </AppDialog>
  )
}
