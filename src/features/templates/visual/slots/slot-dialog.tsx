import { useState } from 'react'
import { nanoid } from 'nanoid'
import { toast } from 'sonner'
import { Network } from 'lucide-react'
import { AppDialog } from '@/components/app-primitives'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { ProxyGroupDraft, SourceSlotDraft } from '../model'

export function SlotDialog({
  slots,
  groups,
  value,
  onSave,
  children,
}: {
  slots: SourceSlotDraft[]
  groups: ProxyGroupDraft[]
  value?: SourceSlotDraft
  onSave: (slot: SourceSlotDraft) => void
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(value?.name || '')

  function show() {
    if (!value && slots.length >= 20) {
      toast.error('模板最多支持 20 个节点源槽位')
      return
    }
    setName(value?.name || '')
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
      onSave({ ...value, name: trimmed })
    } else {
      onSave({
        key: `__WANGWANG_SOURCE_SLOT_${nanoid(6)}__`,
        name: trimmed,
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
            <Field>
              <FieldLabel>槽位名称</FieldLabel>
              <Input
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
              <p className="text-xs text-muted-foreground mt-1.5">
                用于在分流订阅中标识该槽位，建议使用清晰的功能或地区名称。
              </p>
            </Field>

            {value && (
              <Field>
                <FieldLabel>引用该槽位的代理组</FieldLabel>
                {referencingGroups.length > 0 ? (
                  <div className="template-node-ref-tags">
                    {referencingGroups.map((g) => (
                      <div key={g.id} className="template-node-tag">
                        <Network className="template-node-ref-icon text-blue-500" />
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
