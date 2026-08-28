import { useState } from 'react'
import { DragDropProvider } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Edit2,
  Eye,
  GripVertical,
  Network,
  Plus,
  Radio,
  Server,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { AppDialog, IconButton } from '@/components/app-primitives'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { groupReferences } from './validation'
import { findPotentialRawReferences, newGroup, newRule } from './yaml-adapter'
import type {
  ProxyGroupDraft,
  ProxyGroupMemberDraft,
  RuleDraft,
  RuleTargetDraft,
  StructuredProxyGroupDraft,
  StructuredRuleDraft,
  SupportedLoadBalanceStrategy,
  SupportedProxyGroupType,
  SupportedRuleType,
  VisualIssue,
  VisualTemplateDraft,
} from './model'

const ruleTypes: SupportedRuleType[] = [
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'GEOSITE',
  'GEOIP',
  'IP-CIDR',
  'IP-CIDR6',
  'MATCH',
]
const builtinTarget = (value: 'DIRECT' | 'REJECT'): RuleTargetDraft => ({ kind: 'builtin', value })

export function VisualTemplateEditor({
  draft,
  issues,
  onChange,
}: {
  draft: VisualTemplateDraft
  issues: VisualIssue[]
  onChange: (draft: VisualTemplateDraft) => void
}) {
  const blocking = issues.filter((issue) => issue.level === 'error')
  const update = (next: VisualTemplateDraft) => onChange(next)
  function removeGroup(group: ProxyGroupDraft) {
    const refs = groupReferences(draft, group.id)
    const raw = findPotentialRawReferences(draft, group.name)
    if (refs.groups.length || refs.rules.length || raw.count) {
      toast.error(
        `该代理组被 ${refs.groups.length} 个代理组和 ${refs.rules.length} 条规则引用${raw.count ? '，或被高级配置引用' : ''}`,
      )
      return
    }
    update({ ...draft, groups: draft.groups.filter((item) => item.id !== group.id) })
  }
  function editGroup(group: ProxyGroupDraft, next: ProxyGroupDraft) {
    if (group.name !== next.name && findPotentialRawReferences(draft, group.name).count) {
      toast.error('该代理组可能被高级配置引用，请切换到 YAML 编辑后处理。')
      return
    }
    update({ ...draft, groups: draft.groups.map((item) => (item.id === group.id ? next : item)) })
  }
  function moveRule(index: number, offset: number) {
    const target = index + offset
    if (target < 0 || target >= draft.rules.length) return
    const rules = [...draft.rules]
    ;[rules[index], rules[target]] = [rules[target], rules[index]]
    update({ ...draft, rules })
  }
  return (
    <div className="template-visual-editor">
      {blocking.length > 0 && (
        <Alert variant="destructive" className="template-visual-issues">
          <AlertDescription>{blocking.map((issue) => issue.message).join('；')}</AlertDescription>
        </Alert>
      )}
      {issues.filter((issue) => issue.level === 'warning').length > 0 && (
        <Alert className="template-visual-issues">
          <AlertDescription>
            {issues
              .filter((issue) => issue.level === 'warning')
              .map((issue) => issue.message)
              .join('；')}
          </AlertDescription>
        </Alert>
      )}
      <section className="template-visual-section">
        <header className="template-visual-toolbar">
          <h2>代理组</h2>
          <GroupDialog groups={draft.groups} onSave={(group) => update({ ...draft, groups: [...draft.groups, group] })}>
            <Button type="button" size="sm">
              <Plus data-icon="inline-start" />
              添加代理组
            </Button>
          </GroupDialog>
        </header>
        <DragDropProvider
          onDragEnd={(event) => {
            const { source, target } = event.operation
            if (!source || !target || source.id === target.id) return
            const fromIndex = draft.groups.findIndex((g) => g.id === source.id)
            const toIndex = draft.groups.findIndex((g) => g.id === target.id)
            if (fromIndex !== -1 && toIndex !== -1) {
              const nextGroups = [...draft.groups]
              const [moved] = nextGroups.splice(fromIndex, 1)
              nextGroups.splice(toIndex, 0, moved)
              update({ ...draft, groups: nextGroups })
            }
          }}
        >
          <div className="template-visual-list">
            {draft.groups.map((group, index) => (
              <GroupCard
                key={group.id}
                index={index}
                group={group}
                groups={draft.groups}
                onSave={(next) => editGroup(group, next)}
                onDelete={() => removeGroup(group)}
              />
            ))}
          </div>
        </DragDropProvider>
      </section>
      <section className="template-visual-section">
        <header className="template-visual-toolbar">
          <h2>规则</h2>
          <RuleDialog
            groups={draft.groups}
            rules={draft.rules}
            onSave={(rule) => update({ ...draft, rules: [...draft.rules, rule] })}
          >
            <Button type="button" size="sm">
              <Plus data-icon="inline-start" />
              添加规则
            </Button>
          </RuleDialog>
        </header>
        <div className="template-visual-list">
          {draft.rules.map((rule, index) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              groups={draft.groups}
              first={index === 0}
              last={index === draft.rules.length - 1}
              onMove={(offset) => moveRule(index, offset)}
              onSave={(next) =>
                update({ ...draft, rules: draft.rules.map((item) => (item.id === rule.id ? next : item)) })
              }
              onDelete={() => update({ ...draft, rules: draft.rules.filter((item) => item.id !== rule.id) })}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

function GroupCard({
  group,
  groups,
  index,
  onSave,
  onDelete,
}: {
  group: ProxyGroupDraft
  groups: ProxyGroupDraft[]
  index: number
  onSave: (group: ProxyGroupDraft) => void
  onDelete: () => void
}) {
  const [view, setView] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const { ref, handleRef, isDragging } = useSortable({
    id: group.id,
    index,
  })

  return (
    <article
      ref={ref}
      className={cn('template-visual-card', isDragging && 'template-card-dragging')}
    >
      <header className="template-visual-card-header">
        <div
          ref={handleRef}
          className="template-drag-handle"
          title="拖拽排序"
          aria-label="拖拽排序"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="template-drag-icon" />
        </div>
        <div
          className="template-group-header-info"
          role="button"
          tabIndex={0}
          onClick={() => setExpanded((prev) => !prev)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setExpanded((prev) => !prev)
            }
          }}
        >
          <ChevronDown className={cn('template-collapse-icon', expanded && 'expanded')} />
          <strong>{group.name || '未命名代理组'}</strong>
          <Badge variant="secondary">{group.type}</Badge>
          {!expanded && (
            <span className="template-group-summary">
              {group.kind === 'structured' ? `${group.members.length} 个节点引用` : 'RAW 配置'}
            </span>
          )}
        </div>
        <div className="template-visual-card-actions" onClick={(e) => e.stopPropagation()}>
          {group.kind === 'raw' ? (
            <IconButton
              label="查看详情"
              onClick={(e) => {
                e.stopPropagation()
                setView(true)
              }}
            >
              <Eye />
            </IconButton>
          ) : (
            <GroupDialog groups={groups} value={group} onSave={onSave}>
              <IconButton label="编辑代理组">
                <Edit2 />
              </IconButton>
            </GroupDialog>
          )}
          <IconButton
            label="删除代理组"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <Trash2 />
          </IconButton>
        </div>
      </header>

      {expanded && (
        <div className="template-group-expanded">
          {group.kind === 'raw' ? (
            <div className="template-group-raw-info">
              <p className="muted">当前版本不支持可视化修改，请使用 YAML 编辑。</p>
              {Array.isArray(group.raw?.proxies) && group.raw.proxies.length > 0 && (
                <div className="template-node-ref-section">
                  <div className="template-node-ref-title">引用的节点 ({group.raw.proxies.length})</div>
                  <div className="template-node-ref-tags">
                    {group.raw.proxies.map((proxyName: unknown, idx: number) => (
                      <div key={idx} className="template-node-tag">
                        <Server className="template-node-ref-icon text-muted-foreground" />
                        <span className="template-node-tag-name">{String(proxyName)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="template-group-nodes-section">
              {(group.type !== 'select' || group.url || group.interval || group.tolerance || group.strategy) && (
                <div className="template-group-params">
                  {group.url && (
                    <span className="template-group-param-item">
                      URL: <code>{group.url}</code>
                    </span>
                  )}
                  {group.interval !== undefined && (
                    <span className="template-group-param-item">
                      检测间隔: <code>{group.interval}s</code>
                    </span>
                  )}
                  {group.tolerance !== undefined && (
                    <span className="template-group-param-item">
                      容差: <code>{group.tolerance}ms</code>
                    </span>
                  )}
                  {group.strategy && (
                    <span className="template-group-param-item">
                      策略: <code>{group.strategy}</code>
                    </span>
                  )}
                </div>
              )}
              <div className="template-node-ref-title">
                节点引用列表 ({group.members.length})
              </div>
              {group.members.length === 0 ? (
                <div className="template-node-ref-empty">暂无节点引用</div>
              ) : (
                <div className="template-node-ref-tags">
                  {group.members.map((member, index) => {
                    const label = memberLabel(member, groups)
                    return (
                      <div key={`${member.kind}-${index}`} className="template-node-tag">
                        {member.kind === 'all-proxies' && (
                          <Zap className="template-node-ref-icon text-amber-500" />
                        )}
                        {member.kind === 'group' && (
                          <Network className="template-node-ref-icon text-blue-500" />
                        )}
                        {member.kind === 'builtin' && (
                          <Radio className="template-node-ref-icon text-emerald-500" />
                        )}
                        {member.kind === 'raw' && (
                          <Server className="template-node-ref-icon text-purple-500" />
                        )}
                        <span className="template-node-tag-name">{label}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {view && group.kind === 'raw' && (
        <AppDialog title={`查看：${group.name}`} contentClassName="template-dialog" onClose={() => setView(false)}>
          <pre className="template-raw-preview">{JSON.stringify(group.raw, null, 2)}</pre>
        </AppDialog>
      )}
    </article>
  )
}

function GroupDialog({
  groups,
  value,
  onSave,
  children,
}: {
  groups: ProxyGroupDraft[]
  value?: StructuredProxyGroupDraft
  onSave: (group: StructuredProxyGroupDraft) => void
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<StructuredProxyGroupDraft>(() => value || newGroup('select', groups))

  function show() {
    setForm(value || newGroup('select', groups))
    setOpen(true)
  }

  function save() {
    if (!form.name.trim() || groups.some((group) => group.id !== value?.id && group.name === form.name.trim())) {
      toast.error('代理组名称不能为空且不能重复')
      return
    }
    onSave({ ...form, name: form.name.trim() })
    setOpen(false)
  }
  return (
    <>
      <span
        onClick={(e) => {
          e.stopPropagation()
          show()
        }}
      >
        {children}
      </span>
      {open && (
        <AppDialog
          title={value ? '编辑代理组' : '添加代理组'}
          contentClassName="template-dialog"
          onClose={() => setOpen(false)}
        >
          <FieldGroup className="gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field>
                <FieldLabel>名称</FieldLabel>
                <Input
                  value={form.name}
                  placeholder="代理组名称"
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel>类型</FieldLabel>
                <Select
                  value={form.type}
                  onValueChange={(type: SupportedProxyGroupType) =>
                    setForm({
                      ...form,
                      type,
                      ...(type === 'select'
                        ? { url: undefined, interval: undefined, tolerance: undefined, strategy: undefined }
                        : { url: form.url || 'https://www.gstatic.com/generate_204', interval: form.interval || 300 }),
                      ...(type !== 'url-test' ? { tolerance: undefined } : { tolerance: form.tolerance ?? 50 }),
                      ...(type !== 'load-balance'
                        ? { strategy: undefined }
                        : { strategy: form.strategy || 'consistent-hashing' }),
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="select">select (手动选择)</SelectItem>
                    <SelectItem value="url-test">url-test (自动测速)</SelectItem>
                    <SelectItem value="fallback">fallback (故障转移)</SelectItem>
                    <SelectItem value="load-balance">load-balance (负载均衡)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {form.type !== 'select' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field className={cn(form.type === 'url-test' || form.type === 'load-balance' ? 'sm:col-span-2' : '')}>
                  <FieldLabel>测试 URL</FieldLabel>
                  <Input
                    value={form.url || ''}
                    placeholder="https://www.gstatic.com/generate_204"
                    onChange={(event) => setForm({ ...form, url: event.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel>检测间隔（秒）</FieldLabel>
                  <Input
                    type="number"
                    min={1}
                    value={form.interval ?? 300}
                    onChange={(event) => setForm({ ...form, interval: Number(event.target.value) })}
                  />
                </Field>
                {form.type === 'url-test' && (
                  <Field>
                    <FieldLabel>容差 (tolerance / ms)</FieldLabel>
                    <Input
                      type="number"
                      min={0}
                      value={form.tolerance ?? 50}
                      onChange={(event) => setForm({ ...form, tolerance: Number(event.target.value) })}
                    />
                  </Field>
                )}
                {form.type === 'load-balance' && (
                  <Field>
                    <FieldLabel>均衡策略 (strategy)</FieldLabel>
                    <Select
                      value={form.strategy || 'consistent-hashing'}
                      onValueChange={(strategy: SupportedLoadBalanceStrategy) =>
                        setForm({ ...form, strategy })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="consistent-hashing">consistent-hashing (一致性哈希)</SelectItem>
                        <SelectItem value="round-robin">round-robin (轮询)</SelectItem>
                        <SelectItem value="sticky-sessions">sticky-sessions (会话保持)</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </div>
            )}
            <MemberEditor form={form} groups={groups} onChange={setForm} />
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

function MemberTag({
  member,
  index,
  groups,
  onDelete,
}: {
  member: ProxyGroupMemberDraft
  index: number
  groups: ProxyGroupDraft[]
  onDelete: () => void
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id: `member-${index}`,
    index,
  })
  const label = memberLabel(member, groups)

  return (
    <div ref={ref} className={cn('template-member-tag', isDragging && 'template-member-dragging')}>
      <div ref={handleRef} className="template-member-tag-main" title="按住拖拽排序">
        <GripVertical className="template-tag-drag-icon" />
        {member.kind === 'all-proxies' && <Zap className="template-node-ref-icon text-amber-500" />}
        {member.kind === 'group' && <Network className="template-node-ref-icon text-blue-500" />}
        {member.kind === 'builtin' && <Radio className="template-node-ref-icon text-emerald-500" />}
        {member.kind === 'raw' && <Server className="template-node-ref-icon text-purple-500" />}
        <span className="template-member-tag-name" title={label}>
          {label}
        </span>
      </div>
      <button
        type="button"
        className="template-tag-remove"
        title="删除成员"
        aria-label="删除成员"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
      >
        <X />
      </button>
    </div>
  )
}

function MemberEditor({
  form,
  groups,
  onChange,
}: {
  form: StructuredProxyGroupDraft
  groups: ProxyGroupDraft[]
  onChange: (form: StructuredProxyGroupDraft) => void
}) {
  const choices = [
    { value: 'all', label: '全部节点', icon: Zap, iconColor: 'text-amber-500' },
    { value: 'DIRECT', label: 'DIRECT', icon: Radio, iconColor: 'text-emerald-500' },
    { value: 'REJECT', label: 'REJECT', icon: Radio, iconColor: 'text-emerald-500' },
    ...groups
      .filter((group) => group.id !== form.id && group.name)
      .map((group) => ({ value: `group:${group.id}`, label: group.name, icon: Network, iconColor: 'text-blue-500' })),
  ]

  function addMember(val: string) {
    const member: ProxyGroupMemberDraft =
      val === 'all'
        ? { kind: 'all-proxies' }
        : val === 'DIRECT' || val === 'REJECT'
          ? { kind: 'builtin', value: val }
          : { kind: 'group', groupId: val.slice(6) }
    onChange({ ...form, members: [...form.members, member] })
  }

  return (
    <Field>
      <FieldLabel>成员列表 ({form.members.length})</FieldLabel>
      <DragDropProvider
        onDragEnd={(event) => {
          const { source, target } = event.operation
          if (!source || !target || source.id === target.id) return
          const sourceStr = String(source.id)
          const targetStr = String(target.id)
          if (sourceStr.startsWith('member-') && targetStr.startsWith('member-')) {
            const fromIndex = Number(sourceStr.slice(7))
            const toIndex = Number(targetStr.slice(7))
            if (
              !Number.isNaN(fromIndex) &&
              !Number.isNaN(toIndex) &&
              fromIndex >= 0 &&
              fromIndex < form.members.length &&
              toIndex >= 0 &&
              toIndex < form.members.length
            ) {
              const nextMembers = [...form.members]
              const [moved] = nextMembers.splice(fromIndex, 1)
              nextMembers.splice(toIndex, 0, moved)
              onChange({ ...form, members: nextMembers })
            }
          }
        }}
      >
        <div className="template-member-tags-container">
          {form.members.map((member, index) => (
            <MemberTag
              key={`${member.kind}-${member.kind === 'group' ? member.groupId : member.kind === 'builtin' || member.kind === 'raw' ? member.value : 'all'}-${index}`}
              member={member}
              index={index}
              groups={groups}
              onDelete={() => onChange({ ...form, members: form.members.filter((_, idx) => idx !== index) })}
            />
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="template-member-add-trigger"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Plus className="template-add-tag-icon" />
                <span>添加成员</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-56 overflow-y-auto">
              {choices.map((choice) => {
                const Icon = choice.icon
                return (
                  <DropdownMenuItem key={choice.value} onClick={() => addMember(choice.value)}>
                    <Icon className={cn('size-3.5', choice.iconColor)} />
                    <span>{choice.label}</span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </DragDropProvider>
    </Field>
  )
}

function RuleCard({
  rule,
  groups,
  first,
  last,
  onMove,
  onSave,
  onDelete,
}: {
  rule: RuleDraft
  groups: ProxyGroupDraft[]
  first: boolean
  last: boolean
  onMove: (offset: number) => void
  onSave: (rule: RuleDraft) => void
  onDelete: () => void
}) {
  const label =
    rule.kind === 'raw'
      ? `高级规则：${rule.raw}`
      : `${rule.type}${rule.value ? ` ${rule.value}` : ''} → ${targetLabel(rule.target, groups)}${rule.noResolve ? ' · no-resolve' : ''}`
  return (
    <article className="template-rule-row">
      <div className="template-rule-move">
        <IconButton label="上移" disabled={first} onClick={() => onMove(-1)}>
          <ArrowUp />
        </IconButton>
        <IconButton label="下移" disabled={last} onClick={() => onMove(1)}>
          <ArrowDown />
        </IconButton>
      </div>
      <span>{label}</span>
      <div className="template-rule-actions">
        {rule.kind === 'structured' && (
          <RuleDialog groups={groups} value={rule} rules={[]} onSave={onSave}>
            <Button type="button" variant="outline" size="sm">
              <Edit2 data-icon="inline-start" />
              编辑
            </Button>
          </RuleDialog>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onDelete}>
          <Trash2 data-icon="inline-start" />
          删除
        </Button>
      </div>
    </article>
  )
}

function RuleDialog({
  groups,
  rules,
  value,
  onSave,
  children,
}: {
  groups: ProxyGroupDraft[]
  rules: RuleDraft[]
  value?: StructuredRuleDraft
  onSave: (rule: StructuredRuleDraft) => void
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<StructuredRuleDraft>(() => value || newRule(builtinTarget('DIRECT')))
  function show() {
    setForm(value || newRule(builtinTarget('DIRECT')))
    setOpen(true)
  }
  function save() {
    if (form.type === 'MATCH' && !value && rules.some((rule) => rule.kind === 'structured' && rule.type === 'MATCH')) {
      toast.error('已有 MATCH 兜底规则')
      return
    }
    if (form.type !== 'MATCH' && !form.value?.trim()) {
      toast.error('匹配值不能为空')
      return
    }
    onSave(form)
    setOpen(false)
  }
  const targetValue =
    form.target.kind === 'group'
      ? `group:${form.target.groupId}`
      : form.target.kind === 'builtin'
        ? form.target.value
        : `raw:${form.target.value}`
  function setTarget(next: string) {
    setForm({
      ...form,
      target: next.startsWith('group:')
        ? { kind: 'group', groupId: next.slice(6) }
        : next === 'DIRECT' || next === 'REJECT'
          ? { kind: 'builtin', value: next }
          : { kind: 'raw', value: next.slice(4) },
    })
  }
  return (
    <>
      {<span onClick={show}>{children}</span>}
      {open && (
        <AppDialog
          title={value ? '编辑规则' : '添加规则'}
          contentClassName="template-dialog"
          onClose={() => setOpen(false)}
        >
          <FieldGroup>
            <Field>
              <FieldLabel>规则类型</FieldLabel>
              <Select
                value={form.type}
                onValueChange={(type: SupportedRuleType) =>
                  setForm({
                    ...form,
                    type,
                    value: type === 'MATCH' ? undefined : form.value,
                    noResolve: type === 'GEOIP' || type === 'IP-CIDR' || type === 'IP-CIDR6' ? form.noResolve : false,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ruleTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {form.type !== 'MATCH' && (
              <Field>
                <FieldLabel>匹配值</FieldLabel>
                <Input value={form.value || ''} onChange={(event) => setForm({ ...form, value: event.target.value })} />
              </Field>
            )}
            <Field>
              <FieldLabel>目标</FieldLabel>
              <Select value={targetValue} onValueChange={setTarget}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {groups
                    .filter((group) => group.name)
                    .map((group) => (
                      <SelectItem key={group.id} value={`group:${group.id}`}>
                        {group.name}
                      </SelectItem>
                    ))}
                  <SelectItem value="DIRECT">DIRECT</SelectItem>
                  <SelectItem value="REJECT">REJECT</SelectItem>
                  {form.target.kind === 'raw' && (
                    <SelectItem value={`raw:${form.target.value}`}>{form.target.value}（高级）</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </Field>
            {['GEOIP', 'IP-CIDR', 'IP-CIDR6'].includes(form.type) && (
              <Field orientation="horizontal">
                <Checkbox
                  checked={form.noResolve}
                  onCheckedChange={(checked) => setForm({ ...form, noResolve: checked === true })}
                />
                <FieldLabel>no-resolve</FieldLabel>
              </Field>
            )}
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

function memberLabel(member: ProxyGroupMemberDraft, groups: ProxyGroupDraft[] = []): string {
  if (member.kind === 'all-proxies') {
    return '全部节点'
  }
  if (member.kind === 'builtin' || member.kind === 'raw') {
    return member.value
  }
  if (member.kind === 'group') {
    return groups.find((group) => group.id === member.groupId)?.name || '未知代理组'
  }
  return '未知成员'
}

function targetLabel(target: RuleTargetDraft, groups: ProxyGroupDraft[]): string {
  if (target.kind === 'builtin' || target.kind === 'raw') {
    return target.value
  }
  if (target.kind === 'group') {
    return groups.find((group) => group.id === target.groupId)?.name || '未知代理组'
  }
  return '未知目标'
}
