import { useState, useMemo, useRef, useEffect } from 'react'
import { DragDropProvider } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  Code,
  Edit2,
  Eye,
  Globe,
  GripVertical,
  MapPin,
  Network,
  Pencil,
  Plus,
  Radio,
  Search,
  Server,
  Smile,
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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

function getRuleTypeMeta(type: string) {
  switch (type) {
    case 'DOMAIN':
    case 'DOMAIN-SUFFIX':
    case 'DOMAIN-KEYWORD':
      return {
        badgeClass: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900/60',
        colorClass: 'text-blue-600 dark:text-blue-400',
        Icon: Globe,
      }
    case 'GEOSITE':
    case 'GEOIP':
      return {
        badgeClass: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-900/60',
        colorClass: 'text-purple-600 dark:text-purple-400',
        Icon: MapPin,
      }
    case 'IP-CIDR':
    case 'IP-CIDR6':
      return {
        badgeClass: 'bg-amber-500/10 text-amber-800 dark:text-amber-400 border-amber-200 dark:border-amber-900/60',
        colorClass: 'text-amber-600 dark:text-amber-400',
        Icon: Network,
      }
    case 'MATCH':
      return {
        badgeClass: 'bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-800/60',
        colorClass: 'text-violet-600 dark:text-violet-400',
        Icon: Zap,
      }
    default:
      return {
        badgeClass: 'bg-muted text-muted-foreground border-border',
        colorClass: 'text-muted-foreground',
        Icon: Code,
      }
  }
}

export function VisualTemplateEditor({
  draft,
  issues,
  onChange,
}: {
  draft: VisualTemplateDraft
  issues: VisualIssue[]
  onChange: (draft: VisualTemplateDraft) => void
}) {
  const [ruleQuery, setRuleQuery] = useState('')
  const blocking = issues.filter((issue) => issue.level === 'error')
  const update = (next: VisualTemplateDraft) => onChange(next)

  const firstMatchIndex = draft.rules.findIndex((r) => r.kind === 'structured' && r.type === 'MATCH')
  const hasMatchNotLast = firstMatchIndex !== -1 && firstMatchIndex !== draft.rules.length - 1

  function fixMatchOrder() {
    const nonMatchRules = draft.rules.filter((r) => !(r.kind === 'structured' && r.type === 'MATCH'))
    const matchRules = draft.rules.filter((r) => r.kind === 'structured' && r.type === 'MATCH')
    update({ ...draft, rules: [...nonMatchRules, ...matchRules] })
    toast.success('已将 MATCH 兜底规则移至最末尾')
  }

  function addRule(rule: StructuredRuleDraft) {
    if (firstMatchIndex !== -1 && rule.type !== 'MATCH') {
      const nextRules = [...draft.rules]
      nextRules.splice(firstMatchIndex, 0, rule)
      update({ ...draft, rules: nextRules })
    } else {
      update({ ...draft, rules: [...draft.rules, rule] })
    }
  }

  function moveRule(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= draft.rules.length || toIndex >= draft.rules.length) return
    const nextRules = [...draft.rules]
    const [moved] = nextRules.splice(fromIndex, 1)
    nextRules.splice(toIndex, 0, moved)
    update({ ...draft, rules: nextRules })
  }

  const filteredRulesWithIndex = useMemo(() => {
    const query = ruleQuery.trim().toLowerCase()
    return draft.rules
      .map((rule, originalIndex) => ({ rule, originalIndex }))
      .filter(({ rule }) => {
        if (!query) return true
        if (rule.kind === 'raw') return rule.raw.toLowerCase().includes(query)
        const typeMatch = rule.type.toLowerCase().includes(query)
        const valMatch = (rule.value || '').toLowerCase().includes(query)
        const targetText = targetLabel(rule.target, draft.groups).toLowerCase()
        const targetMatch = targetText.includes(query)
        return typeMatch || valMatch || targetMatch
      })
  }, [draft.rules, draft.groups, ruleQuery])

  function removeGroup(group: ProxyGroupDraft) {
    const refs = groupReferences(draft, group.id)
    const raw = findPotentialRawReferences(draft, group.name)
    if (refs.groups.length || refs.rules.length || raw.count) {
      toast.error(
        `该代理组被 ${refs.groups.length} 个代理组和 ${refs.rules.length} 条规则引用${raw.count ? '，或被高级配置引用' : ''}`,
      )
      return
    }
    update({
      ...draft,
      groups: draft.groups.filter((item) => item.id !== group.id),
    })
  }
  function editGroup(current: ProxyGroupDraft, next: ProxyGroupDraft) {
    update({
      ...draft,
      groups: draft.groups.map((item) => (item.id === current.id ? next : item)),
    })
  }
  return (
    <div className="template-visual-editor">
      {issues.length > 0 && (
        <Alert
          variant={blocking.length ? 'destructive' : 'default'}
          className={cn(
            'template-visual-issues',
            blocking.length
              ? 'border-destructive/60 bg-destructive/10'
              : 'border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-100',
          )}
        >
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
            <Button type="button" size="default">
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
          <div className="template-rule-header-left">
            <h2>规则</h2>
            <span className="template-section-count">
              {ruleQuery ? `${filteredRulesWithIndex.length} / ${draft.rules.length}` : draft.rules.length}
            </span>
            {hasMatchNotLast && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="template-fix-match-btn"
                onClick={fixMatchOrder}
              >
                <AlertTriangle className="size-3.5 mr-1 text-amber-500" />
                将 MATCH 置底
              </Button>
            )}
          </div>
          <div className="template-rule-header-right">
            {draft.rules.length >= 4 && (
              <div className="template-rule-search-box">
                <Search className="template-rule-search-icon" />
                <Input
                  placeholder="搜索规则 (类型/域名/目标)..."
                  value={ruleQuery}
                  onChange={(e) => setRuleQuery(e.target.value)}
                  className="template-rule-search-input"
                />
                {ruleQuery && (
                  <button
                    type="button"
                    onClick={() => setRuleQuery('')}
                    className="template-rule-search-clear"
                    title="清除搜索"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            )}
            <RuleDialog
              groups={draft.groups}
              rules={draft.rules}
              onSave={(rule) => addRule(rule)}
            >
              <Button type="button" size="default">
                <Plus data-icon="inline-start" />
                添加规则
              </Button>
            </RuleDialog>
          </div>
        </header>
        <DragDropProvider
          onDragEnd={(event) => {
            const { source, target } = event.operation
            if (!source || !target || source.id === target.id) return
            const fromIndex = draft.rules.findIndex((r) => r.id === source.id)
            const toIndex = draft.rules.findIndex((r) => r.id === target.id)
            if (fromIndex !== -1 && toIndex !== -1) {
              moveRule(fromIndex, toIndex)
            }
          }}
        >
          <div className="template-visual-list">
            {filteredRulesWithIndex.map(({ rule, originalIndex }) => (
              <RuleCard
                key={rule.id}
                index={originalIndex}
                rule={rule}
                groups={draft.groups}
                isAfterMatch={firstMatchIndex !== -1 && originalIndex > firstMatchIndex}
                issues={issues.filter((i) => i.ruleId === rule.id)}
                onSave={(next) =>
                  update({ ...draft, rules: draft.rules.map((item) => (item.id === rule.id ? next : item)) })
                }
                onDelete={() => update({ ...draft, rules: draft.rules.filter((item) => item.id !== rule.id) })}
              />
            ))}
          </div>
        </DragDropProvider>
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
              {group.kind === 'structured' ? `${group.members.length} 个节点/子组` : 'RAW 配置'}
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
                包含节点与子组 ({group.members.length})
              </div>
              {group.members.length === 0 ? (
                <div className="template-node-ref-empty">暂无包含节点与子组</div>
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

const EMOJI_PREFIX_REGEX = /^(\p{Extended_Pictographic}|\p{Regional_Indicator}{2})\s*/u

function ProxyGroupIconPicker({ onSelect }: { onSelect: (icon: string) => void }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'common' | 'region' | 'service'>('common')

  const iconGroups = {
    common: [
      { icon: '🚀', label: '节点选择' },
      { icon: '⚡', label: '自动选择' },
      { icon: '🎯', label: '全球直连' },
      { icon: '🛑', label: '全球拦截' },
      { icon: '🐟', label: '漏网之鱼' },
      { icon: '🛡️', label: '广告拦截' },
      { icon: '🪜', label: '科学上网' },
      { icon: '🌐', label: '国际流量' },
      { icon: '⚖️', label: '负载均衡' },
      { icon: '♻️', label: '故障转移' },
      { icon: '🔄', label: '自动回退' },
      { icon: '🔒', label: '隐私保护' },
      { icon: '🧭', label: '导航' },
      { icon: '⚓', label: '锚点' },
      { icon: '🚩', label: '标旗' },
      { icon: '🔮', label: '特殊' },
      { icon: '🕹️', label: '控制' },
      { icon: '⚙️', label: '设置' },
    ],
    region: [
      { icon: '🇭🇰', label: '香港' },
      { icon: '🇹🇼', label: '台湾' },
      { icon: '🇯🇵', label: '日本' },
      { icon: '🇸🇬', label: '新加坡' },
      { icon: '🇺🇸', label: '美国' },
      { icon: '🇰🇷', label: '韩国' },
      { icon: '🇬🇧', label: '英国' },
      { icon: '🇩🇪', label: '德国' },
      { icon: '🇫🇷', label: '法国' },
      { icon: '🇨🇦', label: '加拿大' },
      { icon: '🇦🇺', label: '澳大利亚' },
      { icon: '🇷🇺', label: '俄罗斯' },
      { icon: '🇮🇳', label: '印度' },
      { icon: '🇲🇾', label: '马来西亚' },
      { icon: '🇹🇭', label: '泰国' },
      { icon: '🇻🇳', label: '越南' },
      { icon: '🇵🇭', label: '菲律宾' },
      { icon: '🇧🇷', label: '巴西' },
      { icon: '🇦🇷', label: '阿根廷' },
      { icon: '🇹🇷', label: '土耳其' },
      { icon: '🇨🇳', label: '中国' },
      { icon: '🇪🇺', label: '欧洲' },
      { icon: '🌏', label: '亚太' },
      { icon: '🌎', label: '美洲' },
    ],
    service: [
      { icon: '🤖', label: 'AI/ChatGPT' },
      { icon: '🧠', label: 'OpenAI' },
      { icon: '📺', label: '奈飞/Netflix' },
      { icon: '🎬', label: '流媒体' },
      { icon: '🍿', label: '影视' },
      { icon: '🎵', label: '音乐/Spotify' },
      { icon: '✈️', label: '电报/Telegram' },
      { icon: '💬', label: '聊天' },
      { icon: '🎮', label: '游戏/Steam' },
      { icon: '🍎', label: 'Apple' },
      { icon: 'Ⓜ️', label: 'Microsoft' },
      { icon: '🔍', label: 'Google' },
      { icon: '🐱', label: 'GitHub' },
      { icon: '📦', label: 'Docker' },
      { icon: '📧', label: '邮件' },
      { icon: '📰', label: '新闻' },
      { icon: '🛒', label: '购物' },
      { icon: '💳', label: '支付' },
    ],
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="default"
          className="px-2.5 shrink-0 text-muted-foreground hover:text-foreground"
          title="选择图标"
        >
          <Smile className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2.5">
        <div className="flex items-center justify-between gap-1 mb-2 border-b border-border pb-1.5">
          <span className="text-xs font-medium text-foreground">常用图标</span>
          <div className="flex gap-1">
            {(
              [
                ['common', '常用'],
                ['region', '地区'],
                ['service', '服务'],
              ] as const
            ).map(([key, name]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  'px-1.5 py-0.5 text-xs rounded transition-colors',
                  tab === key
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-6 gap-1 max-h-48 overflow-y-auto p-0.5">
          {iconGroups[tab].map((item) => (
            <button
              key={item.icon + item.label}
              type="button"
              title={item.label}
              className="flex items-center justify-center size-8 rounded text-base hover:bg-accent transition-colors active:scale-95 cursor-pointer"
              onClick={() => {
                onSelect(item.icon)
                setOpen(false)
              }}
            >
              {item.icon}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
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

  function handleSelectIcon(icon: string) {
    if (EMOJI_PREFIX_REGEX.test(form.name)) {
      setForm({ ...form, name: form.name.replace(EMOJI_PREFIX_REGEX, `${icon} `) })
    } else if (form.name.trim()) {
      setForm({ ...form, name: `${icon} ${form.name.trim()}` })
    } else {
      setForm({ ...form, name: `${icon} ` })
    }
  }

  function save() {
    if (!form.name.trim() || groups.some((group) => group.id !== value?.id && group.name === form.name.trim())) {
      toast.error('代理组名称不能为空且不能重复')
      return
    }
    if (form.type !== 'select' && !form.url?.trim()) {
      toast.error('测试 URL 不能为空')
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
                <div className="flex gap-1.5 items-center">
                  <ProxyGroupIconPicker onSelect={handleSelectIcon} />
                  <Input
                    value={form.name}
                    placeholder="例如：🚀 节点选择"
                    className="flex-1 min-w-0"
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                  />
                </div>
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
                        : {
                            url: form.url || 'https://www.gstatic.com/generate_204',
                            interval: form.interval || 300,
                            defaultSelected: undefined,
                          }),
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
            {form.type === 'select' && (
              <Field>
                <FieldLabel>默认节点</FieldLabel>
                <Select
                  value={form.defaultSelected || '__first__'}
                  onValueChange={(defaultSelected) =>
                    setForm({
                      ...form,
                      defaultSelected: defaultSelected === '__first__' ? undefined : defaultSelected,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__first__">第一个节点（默认）</SelectItem>
                    <SelectGroup>
                      {form.members.map((member, index) => {
                        if (member.kind === 'all-proxies') return null
                        const label = memberLabel(member, groups)
                        return (
                          <SelectItem key={`${label}-${index}`} value={label}>
                            {label}
                          </SelectItem>
                        )
                      })}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            )}
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
        title="移除"
        aria-label="移除"
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
      <FieldLabel>包含节点与子组 ({form.members.length})</FieldLabel>
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
                <span>添加节点/组</span>
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

function InlineValueEdit({
  value,
  placeholder = '输入匹配值...',
  onSave,
}: {
  value: string
  placeholder?: string
  onSave: (nextValue: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  const isDirty = draft.trim() !== value.trim()
  const isValid = draft.trim().length > 0

  useEffect(() => {
    if (editing) {
      setDraft(value)
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing, value])

  function submit() {
    const trimmed = draft.trim()
    if (!trimmed) {
      setEditing(false)
      return
    }
    if (trimmed !== value) {
      onSave(trimmed)
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="template-inline-edit-box" onClick={(e) => e.stopPropagation()}>
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          onBlur={submit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(false)
            }
          }}
          aria-invalid={!isValid}
          className="pr-14 font-mono bg-background"
        />
        <div className="template-inline-actions">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault()
              submit()
            }}
            disabled={!isValid || !isDirty}
            title={!isDirty ? '未修改' : '保存 (Enter)'}
            className="template-inline-btn-save"
          >
            <Check className="size-3.5" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault()
              setEditing(false)
            }}
            title="取消 (Esc)"
            className="template-inline-btn-cancel"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="template-inline-value-display"
      onClick={(e) => e.stopPropagation()}
    >
      <code
        className="template-rule-value select-text cursor-text"
        title={value ? `匹配值：${value}` : '未填写匹配值'}
        onDoubleClick={() => setEditing(true)}
      >
        {value || <span className="text-muted-foreground italic font-normal">(未填写)</span>}
      </code>
      <div className="template-inline-hover-actions">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="template-inline-hover-btn"
          title="就地编辑匹配值"
        >
          <Pencil className="size-3" />
        </button>
      </div>
    </div>
  )
}

function RuleMatcher({
  type,
  value = '',
  mode = 'inline',
  onSave,
  onChange,
  onKeyDown,
  placeholder = '输入匹配值 (如 google.com)',
}: {
  type: SupportedRuleType
  value?: string
  mode?: 'inline' | 'form'
  onSave?: (type: SupportedRuleType, value?: string) => void
  onChange?: (type: SupportedRuleType, value?: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  placeholder?: string
}) {
  if (mode === 'form') {
    return (
      <div className="template-matcher-form-group" onClick={(e) => e.stopPropagation()}>
        <Select
          value={type}
          onValueChange={(t: SupportedRuleType) => onChange?.(t, t === 'MATCH' ? undefined : value)}
        >
          <SelectTrigger className="w-[155px] font-mono">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {ruleTypes.map((t) => {
                const meta = getRuleTypeMeta(t)
                const Icon = meta.Icon
                return (
                  <SelectItem key={t} value={t} className="font-mono">
                    <span className="flex items-center gap-1.5">
                      <Icon className={cn('size-3.5 shrink-0', meta.colorClass)} />
                      <span>{t}</span>
                    </span>
                  </SelectItem>
                )
              })}
            </SelectGroup>
          </SelectContent>
        </Select>

        {type === 'MATCH' ? (
          <div className="template-matcher-match-placeholder">
            兜底规则（MATCH）
          </div>
        ) : (
          <Input
            value={value || ''}
            onChange={(e) => onChange?.(type, e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="template-matcher-form-input"
          />
        )}
      </div>
    )
  }

  return (
    <div
      className="template-matcher-inline-container"
      onClick={(e) => e.stopPropagation()}
    >
      <Select
        value={type}
        onValueChange={(nextType: SupportedRuleType) => {
          onSave?.(nextType, nextType === 'MATCH' ? undefined : value)
        }}
      >
        <SelectTrigger
          className="w-auto font-mono cursor-pointer select-none"
          title="点击切换规则类型"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {ruleTypes.map((t) => {
              const meta = getRuleTypeMeta(t)
              const Icon = meta.Icon
              return (
                <SelectItem key={t} value={t} className="font-mono">
                  <span className="flex items-center gap-1.5">
                    <Icon className={cn('size-3.5 shrink-0', meta.colorClass)} />
                    <span>{t}</span>
                  </span>
                </SelectItem>
              )
            })}
          </SelectGroup>
        </SelectContent>
      </Select>

      {type === 'MATCH' ? (
        <span className="template-rule-match-desc text-xs">
          兜底规则（MATCH）
        </span>
      ) : (
        <InlineValueEdit
          value={value || ''}
          placeholder={placeholder}
          onSave={(nextValue) => onSave?.(type, nextValue)}
        />
      )}
    </div>
  )
}

function RuleCard({
  rule,
  groups,
  index,
  isAfterMatch,
  issues,
  onSave,
  onDelete,
}: {
  rule: RuleDraft
  groups: ProxyGroupDraft[]
  index: number
  isAfterMatch?: boolean
  issues?: VisualIssue[]
  onSave: (rule: RuleDraft) => void
  onDelete: () => void
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id: rule.id,
    index,
  })

  const isMatch = rule.kind === 'structured' && rule.type === 'MATCH'
  const typeMeta = rule.kind === 'structured' ? getRuleTypeMeta(rule.type) : getRuleTypeMeta('RAW')
  const TypeIcon = typeMeta.Icon

  const targetValue =
    rule.kind === 'structured'
      ? rule.target.kind === 'group'
        ? `group:${rule.target.groupId}`
        : rule.target.kind === 'builtin'
          ? rule.target.value
          : `raw:${rule.target.value}`
      : ''

  function handleTargetChange(next: string) {
    if (rule.kind !== 'structured') return
    const newTarget: RuleTargetDraft = next.startsWith('group:')
      ? { kind: 'group', groupId: next.slice(6) }
      : next === 'DIRECT' || next === 'REJECT'
        ? { kind: 'builtin', value: next }
        : { kind: 'raw', value: next.slice(4) }
    onSave({ ...rule, target: newTarget })
  }

  const hasIssues = Boolean(issues && issues.length > 0)

  return (
    <article
      ref={ref}
      className={cn(
        'template-rule-row',
        isDragging && 'template-card-dragging',
        isMatch && 'template-rule-match-row',
        isAfterMatch && 'template-rule-unreachable',
        hasIssues && 'template-rule-issue',
      )}
    >
      <div
        ref={handleRef}
        className="template-drag-handle"
        title="拖拽排序"
        aria-label="拖拽排序"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="template-drag-icon" />
      </div>

      <div className="template-rule-content">
        {rule.kind === 'raw' ? (
          <div className="template-rule-raw">
            <Badge variant="outline" className={cn('text-xs font-mono shrink-0 gap-1.5 px-2.5 py-0.5', typeMeta.badgeClass)}>
              <TypeIcon className="size-3.5" />
              RAW
            </Badge>
            <InlineValueEdit
              value={rule.raw}
              placeholder="输入完整规则内容..."
              onSave={(nextRaw) => onSave({ ...rule, raw: nextRaw })}
            />
          </div>
        ) : (
          <div className="template-rule-grid">
            <div className="template-rule-col-matcher">
              <RuleMatcher
                mode="inline"
                type={rule.type}
                value={rule.value}
                onSave={(nextType, nextValue) =>
                  onSave({
                    ...rule,
                    type: nextType,
                    value: nextValue,
                    noResolve: ['GEOIP', 'IP-CIDR', 'IP-CIDR6'].includes(nextType) ? rule.noResolve : false,
                  })
                }
              />
            </div>

            <div className="template-rule-col-arrow">
              <ArrowRight className="template-rule-arrow" />
            </div>

            <div className="template-rule-col-target">
              <div className="template-rule-target-wrapper" onClick={(e) => e.stopPropagation()}>
                <Select value={targetValue} onValueChange={handleTargetChange}>
                  <SelectTrigger
                    className="w-full min-w-[130px] max-w-[200px] cursor-pointer select-none"
                    title="点击切换目标策略"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {groups
                        .filter((group) => group.name)
                        .map((group) => (
                          <SelectItem key={group.id} value={`group:${group.id}`}>
                            {group.name}
                          </SelectItem>
                        ))}
                      <SelectItem value="DIRECT">DIRECT</SelectItem>
                      <SelectItem value="REJECT">REJECT</SelectItem>
                      {rule.target.kind === 'raw' && (
                        <SelectItem value={`raw:${rule.target.value}`}>
                          {rule.target.value}（高级）
                        </SelectItem>
                      )}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              {rule.kind === 'structured' && ['GEOIP', 'IP-CIDR', 'IP-CIDR6'].includes(rule.type) && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={rule.noResolve}
                        onCheckedChange={(checked) => onSave({ ...rule, noResolve: checked === true })}
                      />
                      <span>no-resolve</span>
                    </label>
                  </TooltipTrigger>
                  <TooltipContent>不解析域名，避免额外 DNS 查询</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        )}
      </div>

      {isAfterMatch && (
        <div
          className="template-rule-warning-pill shrink-0"
          title="该规则位于 MATCH 兜底规则之后，永远不会生效"
        >
          <AlertCircle className="size-3.5" />
          <span>不可达</span>
        </div>
      )}

      {hasIssues && (
        <div
          className="template-rule-error-pill shrink-0"
          title={issues?.map((i) => i.message).join('\n')}
        >
          <AlertCircle className="size-3.5" />
          <span>配置异常</span>
        </div>
      )}

      <div className="template-rule-actions">
        <IconButton label="删除规则" onClick={onDelete}>
          <Trash2 />
        </IconButton>
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
              <FieldLabel>匹配条件 (类型与值)</FieldLabel>
              <RuleMatcher
                mode="form"
                type={form.type}
                value={form.value}
                onChange={(t, v) =>
                  setForm({
                    ...form,
                    type: t,
                    value: v,
                    noResolve: ['GEOIP', 'IP-CIDR', 'IP-CIDR6'].includes(t) ? form.noResolve : false,
                  })
                }
              />
            </Field>
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
