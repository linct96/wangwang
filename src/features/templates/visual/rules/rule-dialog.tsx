import { useState } from 'react'
import { toast } from 'sonner'
import { AppDialog } from '@/components/app-primitives'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { newRule } from '../yaml-adapter'
import { changeStructuredRule, RuleMatcher, ruleMatcherValue, setRuleNoResolve } from './rule-card'
import { canUseNoResolve } from '../validation'
import type { ProxyGroupDraft, RuleDraft, RuleProviderDraft, RuleTargetDraft, StructuredRuleDraft } from '../model'
import type { GeoProvider } from './geo-catalog'

const builtinTarget = (value: 'DIRECT' | 'REJECT'): RuleTargetDraft => ({ kind: 'builtin', value })

export function RuleDialog({
  groups,
  ruleProviders,
  rules,
  value,
  onSave,
  children,
  geoProvider = 'metacubex',
}: {
  groups: ProxyGroupDraft[]
  ruleProviders: RuleProviderDraft[]
  rules: RuleDraft[]
  value?: StructuredRuleDraft
  onSave: (rule: StructuredRuleDraft) => void
  children: React.ReactNode
  geoProvider?: GeoProvider | ((type: 'GEOSITE' | 'GEOIP') => GeoProvider)
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
    if (form.type !== 'MATCH' && form.type !== 'RULE-SET' && !form.value.trim()) {
      toast.error('匹配值不能为空')
      return
    }
    if (form.type === 'RULE-SET' && form.provider.kind === 'raw' && !form.provider.value) {
      toast.error('请先创建并选择规则集数据源')
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
              <FieldLabel>{form.type === 'RULE-SET' ? '规则集数据源' : '匹配条件 (类型与值)'}</FieldLabel>
              <RuleMatcher
                mode="form"
                type={form.type}
                value={ruleMatcherValue(form)}
                rawProviderValue={
                  form.type === 'RULE-SET' && form.provider.kind === 'raw' ? form.provider.value : undefined
                }
                ruleProviders={ruleProviders}
                onChange={(t, v) => setForm(changeStructuredRule(form, t, v, ruleProviders))}
                geoProvider={
                  typeof geoProvider === 'function' && (form.type === 'GEOSITE' || form.type === 'GEOIP')
                    ? geoProvider(form.type)
                    : typeof geoProvider === 'string'
                      ? geoProvider
                      : 'metacubex'
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
            {canUseNoResolve(form, { ruleProviders }) && (
              <Field orientation="horizontal">
                <Checkbox
                  checked={form.noResolve}
                  onCheckedChange={(checked) => setForm(setRuleNoResolve(form, checked === true))}
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
