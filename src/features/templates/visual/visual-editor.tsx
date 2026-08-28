import { useState } from 'react'
import { ArrowDown, ArrowUp, Edit2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { AppDialog, IconButton } from '@/components/app-primitives'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { groupReferences } from './validation'
import { findPotentialRawReferences, newGroup, newRule } from './yaml-adapter'
import type {
  ProxyGroupDraft,
  ProxyGroupMemberDraft,
  RuleDraft,
  RuleTargetDraft,
  StructuredProxyGroupDraft,
  StructuredRuleDraft,
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
        <div className="template-visual-list">
          {draft.groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              groups={draft.groups}
              onSave={(next) => editGroup(group, next)}
              onDelete={() => removeGroup(group)}
            />
          ))}
        </div>
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
  onSave,
  onDelete,
}: {
  group: ProxyGroupDraft
  groups: ProxyGroupDraft[]
  onSave: (group: ProxyGroupDraft) => void
  onDelete: () => void
}) {
  const [view, setView] = useState(false)
  return (
    <article className="template-visual-card">
      <header className="template-visual-card-header">
        <div>
          <strong>{group.name || '未命名代理组'}</strong>
          <Badge variant="secondary">{group.type}</Badge>
        </div>
        <div className="template-visual-card-actions">
          {group.kind === 'raw' ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setView(true)}>
              查看
            </Button>
          ) : (
            <GroupDialog groups={groups} value={group} onSave={onSave}>
              <Button type="button" variant="outline" size="sm">
                <Edit2 data-icon="inline-start" />
                编辑
              </Button>
            </GroupDialog>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 data-icon="inline-start" />
            删除
          </Button>
        </div>
      </header>
      {group.kind === 'raw' ? (
        <p className="muted">当前版本不支持可视化修改，请使用 YAML 编辑。</p>
      ) : (
        <p className="template-visual-card-meta">
          成员：{group.members.map(memberLabel).join(' · ') || '无'}
          {group.type !== 'select' && ` · ${group.interval}s`}
          {group.type === 'url-test' && ` · tolerance ${group.tolerance}`}
        </p>
      )}
      {view && group.kind === 'raw' && (
        <AppDialog title={`查看：${group.name}`} onClose={() => setView(false)}>
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
      {<span onClick={show}>{children}</span>}
      {open && (
        <AppDialog title={value ? '编辑代理组' : '添加代理组'} onClose={() => setOpen(false)}>
          <FieldGroup>
            <Field>
              <FieldLabel>名称</FieldLabel>
              <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
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
                      ? { url: undefined, interval: undefined, tolerance: undefined }
                      : { url: form.url || 'https://www.gstatic.com/generate_204', interval: form.interval || 300 }),
                    ...(type !== 'url-test' ? { tolerance: undefined } : { tolerance: form.tolerance ?? 50 }),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="select">select</SelectItem>
                  <SelectItem value="url-test">url-test</SelectItem>
                  <SelectItem value="fallback">fallback</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {form.type !== 'select' && (
              <>
                <Field>
                  <FieldLabel>测试 URL</FieldLabel>
                  <Input value={form.url || ''} onChange={(event) => setForm({ ...form, url: event.target.value })} />
                </Field>
                <Field>
                  <FieldLabel>interval（秒）</FieldLabel>
                  <Input
                    type="number"
                    value={form.interval ?? 300}
                    onChange={(event) => setForm({ ...form, interval: Number(event.target.value) })}
                  />
                </Field>
              </>
            )}
            {form.type === 'url-test' && (
              <Field>
                <FieldLabel>tolerance</FieldLabel>
                <Input
                  type="number"
                  value={form.tolerance ?? 50}
                  onChange={(event) => setForm({ ...form, tolerance: Number(event.target.value) })}
                />
              </Field>
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

function MemberEditor({
  form,
  groups,
  onChange,
}: {
  form: StructuredProxyGroupDraft
  groups: ProxyGroupDraft[]
  onChange: (form: StructuredProxyGroupDraft) => void
}) {
  const [add, setAdd] = useState('')
  const choices = [
    { value: 'all', label: '全部节点（订阅动态注入）' },
    { value: 'DIRECT', label: 'DIRECT' },
    { value: 'REJECT', label: 'REJECT' },
    ...groups
      .filter((group) => group.id !== form.id && group.name)
      .map((group) => ({ value: `group:${group.id}`, label: group.name })),
  ]
  function addMember() {
    if (!add) return
    const member: ProxyGroupMemberDraft =
      add === 'all'
        ? { kind: 'all-proxies' }
        : add === 'DIRECT' || add === 'REJECT'
          ? { kind: 'builtin', value: add }
          : { kind: 'group', groupId: add.slice(6) }
    onChange({ ...form, members: [...form.members, member] })
    setAdd('')
  }
  return (
    <Field>
      <FieldLabel>成员</FieldLabel>
      <div className="template-member-list">
        {form.members.map((member, index) => (
          <div className="template-member-row" key={`${memberLabel(member)}-${index}`}>
            <span>{memberLabel(member)}</span>
            <IconButton
              label="上移"
              disabled={index === 0}
              onClick={() => {
                const members = [...form.members]
                ;[members[index - 1], members[index]] = [members[index], members[index - 1]]
                onChange({ ...form, members })
              }}
            >
              <ArrowUp />
            </IconButton>
            <IconButton
              label="下移"
              disabled={index === form.members.length - 1}
              onClick={() => {
                const members = [...form.members]
                ;[members[index], members[index + 1]] = [members[index + 1], members[index]]
                onChange({ ...form, members })
              }}
            >
              <ArrowDown />
            </IconButton>
            <IconButton
              label="删除成员"
              onClick={() => onChange({ ...form, members: form.members.filter((_, item) => item !== index) })}
            >
              <Trash2 />
            </IconButton>
          </div>
        ))}
      </div>
      <div className="template-member-add">
        <Select value={add} onValueChange={setAdd}>
          <SelectTrigger>
            <SelectValue placeholder="添加成员" />
          </SelectTrigger>
          <SelectContent>
            {choices.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" onClick={addMember}>
          添加
        </Button>
      </div>
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
        <AppDialog title={value ? '编辑规则' : '添加规则'} onClose={() => setOpen(false)}>
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

function memberLabel(member: ProxyGroupMemberDraft): string {
  return member.kind === 'all-proxies'
    ? '全部节点'
    : member.kind === 'builtin'
      ? member.value
      : member.kind === 'raw'
        ? member.value
        : '代理组引用'
}
function targetLabel(target: RuleTargetDraft, groups: ProxyGroupDraft[]) {
  return target.kind === 'builtin' || target.kind === 'raw'
    ? target.value
    : groups.find((group) => group.id === target.groupId)?.name || '未知代理组'
}
