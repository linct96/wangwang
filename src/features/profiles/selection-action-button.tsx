import { CheckSquare, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface SelectionActionButtonProps {
  count: number
  disabled?: boolean
  onSelectAll: () => void
  onClear: () => void
}

export function SelectionActionButton({ count, disabled = false, onSelectAll, onClear }: SelectionActionButtonProps) {
  if (count === 0) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onSelectAll}
        disabled={disabled}
        className="h-7 px-2.5 gap-1.5 text-xs text-muted-foreground hover:text-foreground border-border/70 hover:border-border hover:bg-muted/50 rounded-md font-medium shadow-none transition-all"
      >
        <CheckSquare className="size-3.5" />
        全选
      </Button>
    )
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClear}
      className="h-7 px-2.5 gap-1.5 text-xs text-muted-foreground hover:text-destructive border-border/70 hover:border-destructive/30 hover:bg-destructive/10 rounded-md font-medium shadow-none transition-all"
    >
      <X className="size-3.5" />
      清空
    </Button>
  )
}
