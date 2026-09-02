import { useMemo, useState } from 'react'
import { Check, ChevronDown, Plus, X } from 'lucide-react'
import type { TagOption } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

function normalizeTag(value: string) {
  return value.trim().replace(/[A-Z]/g, (char) => char.toLowerCase())
}

export function TagMultiSelect({
  id,
  value,
  options,
  inherited = [],
  max,
  allowCreate = true,
  placeholder = '选择标签',
  onChange,
  onBlur,
}: {
  id: string
  value: string[]
  options: TagOption[]
  inherited?: TagOption[]
  max: number
  allowCreate?: boolean
  placeholder?: string
  onChange: (value: string[]) => void
  onBlur?: () => void
}) {
  const [query, setQuery] = useState('')
  const selected = useMemo(() => new Set(value.map(normalizeTag)), [value])
  const filtered = useMemo(() => {
    const needle = normalizeTag(query)
    return options.filter((option) => !needle || normalizeTag(option.name).includes(needle))
  }, [options, query])
  const trimmed = query.trim()
  const normalizedQuery = normalizeTag(trimmed)
  const exists = options.some((option) => normalizeTag(option.name) === normalizedQuery)
  const canCreate =
    allowCreate &&
    Boolean(trimmed) &&
    trimmed.length <= 24 &&
    !exists &&
    !selected.has(normalizedQuery) &&
    value.length < max

  function toggle(name: string) {
    const normalized = normalizeTag(name)
    if (selected.has(normalized)) onChange(value.filter((item) => normalizeTag(item) !== normalized))
    else if (value.length < max) onChange([...value, name])
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((name) => (
          <Badge key={normalizeTag(name)} variant="outline">
            {name}
            <button
              type="button"
              className="ml-0.5 rounded-full opacity-60 hover:opacity-100"
              aria-label={`移除标签 ${name}`}
              onClick={() => toggle(name)}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        {inherited.map((tag) => (
          <Badge key={tag.id} variant="secondary" title="来源继承">
            {tag.name}
          </Badge>
        ))}
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            className="w-full justify-between font-normal"
            onBlur={onBlur}
          >
            <span className="text-muted-foreground">
              {value.length ? `已选择 ${value.length} 个标签` : placeholder}
            </span>
            <ChevronDown className="size-4 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标签"
            maxLength={24}
          />
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.map((option) => {
              const active = selected.has(normalizeTag(option.name))
              const disabled = !active && value.length >= max
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={disabled}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => toggle(option.name)}
                >
                  <span>{option.name}</span>
                  {active && <Check className="size-4" />}
                </button>
              )
            })}
            {canCreate && (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onChange([...value, trimmed])
                  setQuery('')
                }}
              >
                <Plus className="size-4" />
                创建「{trimmed}」
              </button>
            )}
            {!filtered.length && !canCreate && (
              <div className="px-2 py-3 text-center text-sm text-muted-foreground">没有匹配标签</div>
            )}
          </div>
          {value.length >= max && <div className="px-2 pt-1 text-xs text-muted-foreground">最多选择 {max} 个标签</div>}
        </PopoverContent>
      </Popover>
    </div>
  )
}
