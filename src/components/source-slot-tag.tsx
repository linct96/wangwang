import { Plug } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TemplateSourceSlot } from '../../shared/source-slots'

export function SourceSlotTag({ slot, title }: { slot: TemplateSourceSlot; title?: string }) {
  return (
    <div className="preview-node-tag" title={title ?? `节点源槽位: ${slot.name} (${slot.key})`}>
      <Plug
        className={cn('size-[13px] shrink-0', slot.type === 'subscription' ? 'text-indigo-500' : 'text-amber-500')}
      />
      <span className="preview-node-tag-name">{slot.name}</span>
    </div>
  )
}
