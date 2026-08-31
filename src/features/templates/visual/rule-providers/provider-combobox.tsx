import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ruleProviderLabel } from '../model'
import type { RuleProviderDraft } from '../model'

export function RuleProviderCombobox({
  providers,
  value,
  rawValue,
  onChange,
}: {
  providers: RuleProviderDraft[]
  value?: string
  rawValue?: string
  onChange: (providerId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = providers.find((provider) => provider.id === value)
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return providers.filter(
      (provider) => !needle || `${provider.name} ${ruleProviderLabel(provider)}`.toLowerCase().includes(needle),
    )
  }, [providers, query])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="min-w-0 flex-1 justify-between font-normal"
        >
          <span className={cn('flex min-w-0 items-center gap-2 text-left', !selected && 'text-muted-foreground')}>
            <span className="min-w-0 truncate">{selected?.name || rawValue || '选择规则集数据源'}</span>
            {selected && <small className="shrink-0 text-muted-foreground">{ruleProviderLabel(selected, false)}</small>}
          </span>
          <ChevronsUpDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-2">
        <Input
          value={query}
          autoFocus
          placeholder="搜索名称、行为或格式"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div
          className="max-h-56 min-h-0 overflow-y-auto overscroll-contain"
          onWheel={(event) => event.stopPropagation()}
        >
          {filtered.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">没有匹配的数据源</p>}
          {filtered.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left hover:bg-accent"
              onClick={() => {
                onChange(provider.id)
                setOpen(false)
                setQuery('')
              }}
            >
              <Check className={cn('size-4 shrink-0', provider.id === value ? 'opacity-100' : 'opacity-0')} />
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-sm font-medium">{provider.name}</strong>
                <small className="block truncate text-muted-foreground">{ruleProviderLabel(provider)}</small>
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
