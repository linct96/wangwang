import { useState } from 'react'
import { AppDialog } from '@/components/app-primitives'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { SourceSlotDraft } from '../model'

export function SourceSlotDialog({
  value,
  existingSlots: _existingSlots,
  onSave,
  children,
}: {
  value?: SourceSlotDraft
  existingSlots: SourceSlotDraft[]
  onSave: (name: string) => void
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(value?.name || '')

  function show() {
    setName(value?.name || '')
    setOpen(true)
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    onSave(name.trim())
    setOpen(false)
  }

  return (
    <>
      <span onClick={show} className="contents">
        {children}
      </span>
      {open && (
        <AppDialog
          title={value ? '编辑节点源槽位' : '添加节点源槽位'}
          contentClassName="template-dialog"
          onClose={() => setOpen(false)}
        >
          <form onSubmit={handleSave}>
            <FieldGroup>
              <Field>
                <FieldLabel>槽位名称</FieldLabel>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="如：主力节点源、备用节点源"
                  maxLength={40}
                  autoFocus
                  required
                />
              </Field>
              {value && (
                <Field>
                  <FieldLabel>槽位 Key（不可修改）</FieldLabel>
                  <Input value={value.key} readOnly disabled className="font-mono text-xs" />
                </Field>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  取消
                </Button>
                <Button type="submit" disabled={!name.trim()}>
                  保存
                </Button>
              </div>
            </FieldGroup>
          </form>
        </AppDialog>
      )}
    </>
  )
}
