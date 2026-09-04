import { useState } from 'react'
import { nanoid } from 'nanoid'
import { LibraryBig, ListPlus, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { groupReferences, resolvePresetNoResolve, ruleProviderReferences } from './validation'
import { findPotentialRawProviderReferences, findPotentialRawReferences, newRule } from './yaml-adapter'
import { GroupList } from './groups/group-list'
import { RuleList } from './rules/rule-list'
import { GroupDialog } from './groups/group-dialog'
import { RuleDialog } from './rules/rule-dialog'
import {
  type ProxyGroupDraft,
  type RuleSetRuleDraft,
  type RuleProviderDraft,
  type StructuredRuleDraft,
  type VisualChangeMeta,
  type VisualIssue,
  type VisualTemplateDraft,
} from './model'
import type { GeoProvider } from './rules/geo-catalog'
import { GeoSettingsPanel } from './geo/geo-settings-panel'
import { ProviderDialog, ProviderList } from './rule-providers'
import { applyRuleSetPresets, insertRulesBeforeMatch, RuleSetPresetDialog } from './rule-set-presets'

export function VisualTemplateEditor({
  draft,
  issues,
  onChange,
  geoProvider = 'metacubex',
  customGeo = false,
}: {
  draft: VisualTemplateDraft
  issues: VisualIssue[]
  onChange: (draft: VisualTemplateDraft, meta?: VisualChangeMeta) => void
  geoProvider?: GeoProvider | ((type: 'GEOSITE' | 'GEOIP') => GeoProvider)
  customGeo?: boolean
}) {
  const warnings = issues.filter((issue) => issue.level === 'warning')
  const [slotName, setSlotName] = useState('')
  const update = (next: VisualTemplateDraft, meta?: VisualChangeMeta) => onChange(next, meta)

  function addSlot() {
    const name = slotName.trim()
    if (!name) return
    if (draft.sourceSlots.some((slot) => slot.name === name)) return void toast.error('槽位名称不能重复')
    update({
      ...draft,
      sourceSlots: [...draft.sourceSlots, { key: `__WANGWANG_SOURCE_SLOT_${nanoid(6)}__`, name }],
    })
    setSlotName('')
  }

  function removeSlot(key: string) {
    const used = draft.groups.some(
      (group) =>
        group.kind === 'structured' &&
        group.members.some((member) => member.kind === 'source-slot' && member.slotKey === key),
    )
    if (used) return void toast.error('该槽位正在被代理组引用，请先移除引用')
    if (draft.sourceSlots.length === 1) return void toast.error('模板至少需要一个节点源槽位')
    update({ ...draft, sourceSlots: draft.sourceSlots.filter((slot) => slot.key !== key) })
  }

  function addRule(rule: StructuredRuleDraft) {
    update({
      ...draft,
      rules: rule.type === 'MATCH' ? [...draft.rules, rule] : insertRulesBeforeMatch(draft.rules, [rule]),
    })
  }

  function addRuleForProvider(provider: RuleProviderDraft) {
    const target = { kind: 'builtin' as const, value: 'DIRECT' as const }
    const rule: RuleSetRuleDraft = {
      kind: 'structured',
      id: newRule(target).id,
      type: 'RULE-SET',
      provider: { kind: 'provider', providerId: provider.id },
      target,
      noResolve: resolvePresetNoResolve(provider, true),
    }
    addRule(rule)
    toast.success(`已将“${provider.name}”添加到分流规则`)
  }

  function removeGroup(group: ProxyGroupDraft) {
    const refs = groupReferences(draft, group.id)
    const raw = findPotentialRawReferences(draft, group.name)
    if (refs.groups.length || refs.rules.length || refs.ruleProviders.length || raw.count) {
      toast.error(
        `该代理组被 ${refs.groups.length} 个代理组、${refs.rules.length} 条规则和 ${refs.ruleProviders.length} 个规则集数据源引用${raw.count ? '，或被高级配置引用' : ''}`,
      )
      return
    }
    update({
      ...draft,
      groups: draft.groups.filter((item) => item.id !== group.id),
    })
  }

  function removeProvider(provider: RuleProviderDraft) {
    const references = ruleProviderReferences(draft, provider.id)
    const raw = findPotentialRawProviderReferences(draft, provider.name)
    if (references.length || raw.count) {
      toast.error(
        references.length
          ? `该规则集数据源被 ${references.length} 条分流规则引用，请先修改或删除相关规则`
          : '该数据源可能被高级规则引用，请先检查 YAML',
      )
      return
    }
    update({ ...draft, ruleProviders: draft.ruleProviders.filter((item) => item.id !== provider.id) })
  }

  function updateProviders(ruleProviders: RuleProviderDraft[], meta?: VisualChangeMeta) {
    if (meta?.type === 'reorder') {
      update({ ...draft, ruleProviders }, meta)
      return
    }
    const renamed = ruleProviders.find((next) => {
      const previous = draft.ruleProviders.find((item) => item.id === next.id)
      return previous && previous.name !== next.name && findPotentialRawProviderReferences(draft, previous.name).count
    })
    if (renamed) toast.warning('高级规则可能仍引用数据源旧名称，请检查 YAML')
    update({ ...draft, ruleProviders })
  }

  function updateGroups(groups: ProxyGroupDraft[], meta?: VisualChangeMeta) {
    if (meta?.type === 'reorder') {
      update({ ...draft, groups }, meta)
      return
    }
    const changed = groups.find((next) => {
      const previous = draft.groups.find((item) => item.id === next.id)
      return previous && previous.name !== next.name
    })
    if (!changed) {
      update({ ...draft, groups })
      return
    }
    const previous = draft.groups.find((item) => item.id === changed.id)!
    if (findPotentialRawReferences(draft, previous.name).count) {
      toast.error('该代理组可能被高级配置引用，请先在 YAML 模式确认后再重命名')
      return
    }
    // default-selected 保存的是名称，不是运行时 groupId；组重命名时必须同步它。
    update({
      ...draft,
      groups: groups.map((group) =>
        group.kind === 'structured' && group.defaultSelected === previous.name
          ? { ...group, defaultSelected: changed.name }
          : group,
      ),
    })
  }
  return (
    <div className="template-visual-editor">
      {warnings.length > 0 && (
        <Alert
          variant="default"
          className="template-visual-issues border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-100"
        >
          <AlertDescription>{warnings.map((issue) => issue.message).join('；')}</AlertDescription>
        </Alert>
      )}
      <GeoSettingsPanel value={draft.geo} issues={issues} onChange={(geo) => update({ ...draft, geo })} />
      <section className="template-visual-section">
        <header className="template-visual-toolbar">
          <div className="template-rule-header-left">
            <h2>节点源槽位</h2>
            <span className="template-section-count">{draft.sourceSlots.length}</span>
          </div>
          <div className="template-rule-header-right">
            <Input
              value={slotName}
              maxLength={40}
              placeholder="槽位名称"
              aria-label="新槽位名称"
              onChange={(event) => setSlotName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addSlot()
                }
              }}
            />
            <Button type="button" variant="outline" disabled={!slotName.trim()} onClick={addSlot}>
              <Plus data-icon="inline-start" />
              添加槽位
            </Button>
          </div>
        </header>
        <div className="template-visual-list">
          {draft.sourceSlots.map((slot) => (
            <div key={slot.key} className="template-visual-card flex items-center gap-2 p-3">
              <Input
                value={slot.name}
                maxLength={40}
                aria-label="槽位名称"
                onChange={(event) =>
                  update({
                    ...draft,
                    sourceSlots: draft.sourceSlots.map((item) =>
                      item.key === slot.key ? { ...item, name: event.target.value } : item,
                    ),
                  })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`删除槽位 ${slot.name}`}
                onClick={() => removeSlot(slot.key)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      </section>
      <section className="template-visual-section">
        <header className="template-visual-toolbar">
          <div className="template-rule-header-left">
            <h2>代理组</h2>
            <span className="template-section-count">{draft.groups.length}</span>
          </div>
          <GroupDialog
            groups={draft.groups}
            sourceSlots={draft.sourceSlots}
            onSave={(group) => update({ ...draft, groups: [...draft.groups, group] })}
          >
            <Button type="button" size="default">
              <Plus data-icon="inline-start" />
              添加代理组
            </Button>
          </GroupDialog>
        </header>
        <GroupList
          groups={draft.groups}
          sourceSlots={draft.sourceSlots}
          onChange={updateGroups}
          onDelete={removeGroup}
        />
      </section>
      <section className="template-visual-section">
        <header className="template-visual-toolbar">
          <div className="template-rule-header-left">
            <h2>规则集数据源</h2>
            <span className="template-section-count">{draft.ruleProviders.length}</span>
          </div>
          <div className="template-rule-header-right">
            <RuleSetPresetDialog
              mode="provider-only"
              draft={draft}
              onApply={(selections, presets) =>
                update(applyRuleSetPresets(draft, presets, selections, 'provider-only'))
              }
            >
              <Button type="button" variant="outline">
                <LibraryBig data-icon="inline-start" />
                从预设添加
              </Button>
            </RuleSetPresetDialog>
            <ProviderDialog
              providers={draft.ruleProviders}
              groups={draft.groups}
              onSave={(provider) => update({ ...draft, ruleProviders: [...draft.ruleProviders, provider] })}
            >
              <Button type="button">
                <Plus data-icon="inline-start" />
                添加数据源
              </Button>
            </ProviderDialog>
          </div>
        </header>
        {draft.ruleProviders.length ? (
          <ProviderList
            draft={draft}
            issues={issues}
            onChange={updateProviders}
            onDelete={removeProvider}
            onUse={addRuleForProvider}
          />
        ) : (
          <div className="rounded-md border border-dashed px-4 py-8 text-center">
            <p className="text-sm font-medium">暂无规则集数据源</p>
            <p className="mt-1 text-sm text-muted-foreground">创建后即可通过 RULE-SET 在分流规则中引用。</p>
          </div>
        )}
      </section>
      <section className="template-visual-section">
        <header className="template-visual-toolbar">
          <div className="template-rule-header-left">
            <h2>分流规则</h2>
            <span className="template-section-count">{draft.rules.length}</span>
          </div>
          <div className="template-rule-header-right">
            <RuleSetPresetDialog
              mode="provider-and-rule"
              draft={draft}
              onApply={(selections, presets) =>
                update(applyRuleSetPresets(draft, presets, selections, 'provider-and-rule'))
              }
            >
              <Button type="button" variant="outline">
                <ListPlus data-icon="inline-start" />
                从规则集添加
              </Button>
            </RuleSetPresetDialog>
            <RuleDialog
              groups={draft.groups}
              ruleProviders={draft.ruleProviders}
              rules={draft.rules}
              geoProvider={geoProvider}
              onSave={(rule) => addRule(rule)}
            >
              <Button type="button" size="default">
                <Plus data-icon="inline-start" />
                添加规则
              </Button>
            </RuleDialog>
          </div>
        </header>
        {customGeo && (
          <Alert>
            <AlertDescription>当前使用自定义 GEO 数据源，建议列表可能与实际数据库不同</AlertDescription>
          </Alert>
        )}
        <RuleList
          rules={draft.rules}
          groups={draft.groups}
          ruleProviders={draft.ruleProviders}
          issues={issues}
          onChange={(rules, meta) => update({ ...draft, rules }, meta)}
          geoProvider={geoProvider}
        />
      </section>
    </div>
  )
}
