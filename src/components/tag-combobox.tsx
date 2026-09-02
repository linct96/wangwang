import { useState } from 'react'
import type { TagOption } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from '@/components/ui/combobox'

function normalizeTag(value: string) {
  return value.trim().toLowerCase()
}

export function TagCombobox({
  id,
  value,
  options,
  inherited = [],
  max,
  allowCreate = true,
  placeholder,
  invalid,
  onChange,
  onBlur,
}: {
  id: string
  value: string[]
  options: TagOption[]
  inherited?: TagOption[]
  max: number
  allowCreate?: boolean
  placeholder: string
  invalid?: boolean
  onChange: (value: string[]) => void
  onBlur?: () => void
}) {
  const [query, setQuery] = useState('')
  const anchor = useComboboxAnchor()
  const trimmedQuery = query.trim()
  const selected = new Set(value.map(normalizeTag))
  const optionNames = options.map((option) => option.name)
  const canCreate =
    allowCreate &&
    Boolean(trimmedQuery) &&
    trimmedQuery.length <= 24 &&
    !optionNames.some((name) => normalizeTag(name) === normalizeTag(trimmedQuery)) &&
    !selected.has(normalizeTag(trimmedQuery)) &&
    value.length < max
  const items = canCreate ? [...optionNames, trimmedQuery] : optionNames

  return (
    <Combobox
      items={items}
      multiple
      autoHighlight
      value={value}
      inputValue={query}
      onInputValueChange={setQuery}
      onValueChange={(nextValue) => onChange(nextValue.slice(0, max))}
    >
      <ComboboxChips ref={anchor}>
        <ComboboxValue>
          {(values: string[]) => (
            <>
              {values.map((tag) => (
                <ComboboxChip key={normalizeTag(tag)}>{tag}</ComboboxChip>
              ))}
              {inherited.map((tag) => (
                <Badge key={tag.id} variant="secondary" title="来源继承">
                  {tag.name}
                </Badge>
              ))}
              <ComboboxChipsInput
                id={id}
                placeholder={values.length ? '继续添加标签' : placeholder}
                maxLength={24}
                aria-invalid={invalid}
                onBlur={onBlur}
              />
            </>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>没有匹配标签</ComboboxEmpty>
        <ComboboxList>
          {(tag) => (
            <ComboboxItem key={tag} value={tag} disabled={!selected.has(normalizeTag(tag)) && value.length >= max}>
              {canCreate && tag === trimmedQuery ? `创建「${tag}」` : tag}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
