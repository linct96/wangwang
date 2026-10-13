import { Plug } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TemplateSourceSlot } from '../../shared/source-slots'

export function SourceSlotTag({
  slot,
  title,
  placeholder = false,
  resolvedName,
}: {
  slot: TemplateSourceSlot
  title?: string
  placeholder?: boolean
  resolvedName?: string
}) {
  return (
    <div
      className={cn(
        'preview-node-tag',
        placeholder && 'border-dashed',
        (placeholder || resolvedName !== undefined) &&
          (slot.type === 'subscription'
            ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-950 dark:text-indigo-200'
            : 'border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-200'),
      )}
      title={title ?? `节点源槽位: ${slot.name} (${slot.key})`}
    >
      <Plug
        className={cn(
          'shrink-0',
          placeholder || resolvedName !== undefined ? 'size-3' : 'size-[13px]',
          slot.type === 'subscription' ? 'text-indigo-500' : 'text-amber-500',
        )}
      />
      <span className="preview-node-tag-name">{resolvedName ?? slot.name}</span>
    </div>
  )
}
