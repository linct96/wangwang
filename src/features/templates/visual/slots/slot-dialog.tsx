import { useState } from 'react'
import { nanoid } from 'nanoid'
import { toast } from 'sonner'
import { AppDialog } from '@/components/app-primitives'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ProxyGroupDraft, SourceSlotDraft } from '../model'

const slotTypeOptions = [
  { value: 'nodes', label: '节点槽位' },
  { value: 'subscription', label: '订阅源槽位' },
]

export function SlotDialog({
  slots,
  groups,
  value,
  typeLocked = false,
  onSave,
  children,
}: {
  slots: SourceSlotDraft[]
  groups: ProxyGroupDraft[]
  value?: SourceSlotDraft
  typeLocked?: boolean
  onSave: (slot: SourceSlotDraft) => void
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(value?.name || '')
  const [type, setType] = useState<'nodes' | 'subscription'>(value?.type || 'nodes')

  function show() {
    if (!value && slots.length >= 20) {
      toast.error('模板最多支持 20 个节点源槽位')
      return
    }
    setName(value?.name || '')
    setType(value?.type || 'nodes')
    setOpen(true)
  }

  function save() {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('槽位名称不能为空')
      return
    }
    if (trimmed.length > 40) {
      toast.error('槽位名称不能超过 40 个字符')
      return
    }
    if (slots.some((s) => s.key !== value?.key && s.name === trimmed)) {
      toast.error('槽位名称不能重复')
      return
    }

    if (value) {
      onSave({ ...value, name: trimmed, type })
    } else {
      onSave({
        key: `__WANGWANG_SOURCE_SLOT_${nanoid(6)}__`,
        name: trimmed,
        type,
      })
    }
    setOpen(false)
  }

  const referencingGroups = value
    ? groups.filter(
        (group) =>
          group.kind === 'structured' && group.members.some((m) => m.kind === 'source-slot' && m.slotKey === value.key),
      )
    : []

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
          title={value ? '编辑节点源槽位' : '添加节点源槽位'}
          contentClassName="template-dialog"
          onClose={() => setOpen(false)}
        >
          <FieldGroup className="gap-4">
            <Field data-disabled={typeLocked && Boolean(value)}>
              <FieldLabel htmlFor="slot-type">槽位类型</FieldLabel>
              <Select
                disabled={typeLocked && Boolean(value)}
                items={slotTypeOptions}
                value={type}
                onValueChange={(next: 'nodes' | 'subscription' | null) => {
                  if (next) setType(next)
                }}
              >
                <SelectTrigger id="slot-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="nodes">节点槽位</SelectItem>
                    <SelectItem value="subscription">订阅源槽位</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                {type === 'subscription'
                  ? '绑定一个 URL 订阅节点源，通过代理组 use 动态加载，不展开本地节点。'
                  : '根据节点源、标签或指定节点筛选并注入，通过 proxies 引用。'}
              </FieldDescription>
              {typeLocked && value && (
                <FieldDescription>此槽位已被配置绑定，不能修改类型；代理组引用与配置绑定相互独立。</FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="slot-name">槽位名称</FieldLabel>
              <Input
                id="slot-name"
                value={name}
                maxLength={40}
                placeholder="例如：🚀 主力节点、香港节点"
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    save()
                  }
                }}
              />
              <FieldDescription>用于在分流订阅中标识该槽位，建议使用清晰的功能或地区名称。</FieldDescription>
            </Field>

            {value && (
              <Field>
                <FieldLabel>引用该槽位的代理组</FieldLabel>
                {referencingGroups.length > 0 ? (
                  <div className="template-node-ref-tags">
                    {referencingGroups.map((g) => (
                      <div key={g.id} className="template-node-tag">
                        <span className="template-node-tag-name">{g.name}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="template-node-ref-empty">暂未被任何代理组引用</div>
                )}
              </Field>
            )}
          </FieldGroup>
          <div className="dialog-actions">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="button" onClick={save}>
              {value ? '保存' : '添加'}
            </Button>
          </div>
        </AppDialog>
      )}
    </>
  )
}
