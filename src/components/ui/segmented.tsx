import type { ReactNode } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

type SegmentedValue = string | number

type SegmentedOption<Value extends SegmentedValue> = {
  value: Value
  label: ReactNode
}

type SegmentedProps<Value extends SegmentedValue> = {
  value: Value
  options: SegmentedOption<Value>[]
  onChange: (value: Value) => void
  block?: boolean
  className?: string
}

export function Segmented<Value extends SegmentedValue>({
  value,
  options,
  onChange,
  block,
  className,
}: SegmentedProps<Value>) {
  const selectedIndex = options.findIndex((option) => Object.is(option.value, value))

  return (
    <ToggleGroup
      type="single"
      value={String(selectedIndex)}
      onValueChange={(index) => {
        const next = options[Number(index)]?.value
        if (next !== undefined && !Object.is(next, value)) onChange(next)
      }}
      spacing={0}
      className={cn('bg-muted p-0.5', block && 'w-full [&>[data-slot=toggle-group-item]]:flex-1', className)}
    >
      {options.map((option, index) => (
        <ToggleGroupItem
          key={`${typeof option.value}:${String(option.value)}`}
          value={String(index)}
          className="h-7 min-w-7 gap-1 bg-transparent px-2.5 shadow-none hover:bg-background/60 data-[state=on]:bg-background data-[state=on]:shadow-xs"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
