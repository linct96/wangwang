'use client'

import * as React from 'react'

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

type SegmentedValue = string | number

type SegmentedOption<Value extends SegmentedValue> = {
  value: Value
  label?: React.ReactNode
  icon?: React.ReactNode
  disabled?: boolean
  className?: string
  tooltip?: string
}

type SegmentedSemantic<T> = Partial<Record<'root' | 'item' | 'label' | 'icon', T>>

type SegmentedProps<Value extends SegmentedValue = SegmentedValue> = Omit<
  React.ComponentPropsWithoutRef<'div'>,
  'defaultValue' | 'onChange' | 'dir'
> & {
  dir?: 'ltr' | 'rtl'
  options?: Array<Value | SegmentedOption<Value>>
  value?: Value
  defaultValue?: Value
  onChange?: (value: Value) => void
  disabled?: boolean
  block?: boolean
  size?: 'small' | 'medium' | 'large'
  orientation?: 'horizontal' | 'vertical'
  vertical?: boolean
  shape?: 'default' | 'round'
  name?: string
  classNames?: SegmentedSemantic<string> | ((info: { props: SegmentedProps<Value> }) => SegmentedSemantic<string>)
  styles?:
    | SegmentedSemantic<React.CSSProperties>
    | ((info: { props: SegmentedProps<Value> }) => SegmentedSemantic<React.CSSProperties>)
}

function SegmentedInner<Value extends SegmentedValue>(
  props: SegmentedProps<Value>,
  ref: React.ForwardedRef<HTMLDivElement>,
) {
  const {
    options = [],
    value,
    defaultValue,
    onChange,
    disabled = false,
    block = false,
    size = 'medium',
    orientation,
    vertical = false,
    shape = 'default',
    name,
    className,
    classNames,
    styles,
    ...rootProps
  } = props
  const items = options.map((option) => (typeof option === 'object' ? option : { value: option, label: option }))
  const [internalValue, setInternalValue] = React.useState<Value | undefined>(defaultValue ?? items[0]?.value)
  const selectedValue = value === undefined ? internalValue : value
  const selectedIndex = items.findIndex((item) => Object.is(item.value, selectedValue))
  const direction = orientation ?? (vertical ? 'vertical' : 'horizontal')
  const mergedClassNames = typeof classNames === 'function' ? classNames({ props }) : classNames
  const mergedStyles = typeof styles === 'function' ? styles({ props }) : styles

  return (
    <ToggleGroup
      {...rootProps}
      ref={ref}
      type="single"
      value={selectedIndex < 0 ? '' : String(selectedIndex)}
      onValueChange={(nextIndex) => {
        if (!nextIndex) return
        const nextValue = items[Number(nextIndex)]?.value
        if (nextValue === undefined || Object.is(nextValue, selectedValue)) return
        if (value === undefined) setInternalValue(nextValue)
        onChange?.(nextValue)
      }}
      disabled={disabled}
      orientation={direction}
      spacing={0}
      className={cn(
        'bg-muted p-0.5',
        direction === 'vertical' ? 'flex-col items-stretch' : 'flex-row',
        block && 'w-full [&>[data-slot=toggle-group-item]]:flex-1',
        shape === 'round' && 'rounded-full [&>[data-slot=toggle-group-item]]:rounded-full',
        mergedClassNames?.root,
        className,
      )}
      style={{ ...mergedStyles?.root, ...rootProps.style }}
    >
      {items.map((item, index) => (
        <ToggleGroupItem
          key={`${typeof item.value}:${String(item.value)}`}
          value={String(index)}
          disabled={item.disabled}
          title={item.tooltip}
          aria-label={item.tooltip ?? (typeof item.label === 'string' ? item.label : undefined)}
          className={cn(
            'gap-1 bg-transparent px-2.5 shadow-none hover:bg-background/60 data-[state=on]:bg-background data-[state=on]:shadow-xs',
            size === 'small' && 'h-6 min-w-6 text-xs',
            size === 'medium' && 'h-7 min-w-7',
            size === 'large' && 'h-8 min-w-8 text-base',
            mergedClassNames?.item,
            item.className,
          )}
          style={mergedStyles?.item}
        >
          {item.icon && (
            <span className={mergedClassNames?.icon} style={mergedStyles?.icon} data-slot="segmented-icon">
              {item.icon}
            </span>
          )}
          {item.label !== undefined && (
            <span className={mergedClassNames?.label} style={mergedStyles?.label} data-slot="segmented-label">
              {item.label}
            </span>
          )}
        </ToggleGroupItem>
      ))}
      {name && <input type="hidden" name={name} value={selectedValue ?? ''} disabled={disabled} />}
    </ToggleGroup>
  )
}

const Segmented = React.forwardRef(SegmentedInner) as <Value extends SegmentedValue = SegmentedValue>(
  props: SegmentedProps<Value> & React.RefAttributes<HTMLDivElement>,
) => React.ReactElement

export { Segmented }
export type { SegmentedOption, SegmentedProps, SegmentedValue }
