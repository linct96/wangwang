import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { geoLabel, searchGeoCatalog, type GeoCatalogType, type GeoDataset } from './geo-catalog'
import { useGeoCatalog } from './use-geo-catalog'

export function GeoMatchValueCombobox({
  type,
  value,
  dataset,
  onChange,
}: {
  type: 'GEOSITE' | 'GEOIP'
  value?: string
  dataset: GeoDataset
  onChange: (value: string) => void
}) {
  const catalogType: GeoCatalogType = type.toLowerCase() as GeoCatalogType
  const { data, error, loading } = useGeoCatalog(catalogType, dataset)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const items = searchGeoCatalog(data?.items || [], value || '')
  const choose = (next: string) => {
    onChange(next)
    setOpen(false)
  }
  return (
    <div className="relative flex-1">
      <Input
        value={value || ''}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!open) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((i) => Math.min(i + 1, Math.max(items.length - 1, 0)))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && value) {
            e.preventDefault()
            choose(items[active] || value)
          }
        }}
        placeholder="输入匹配值..."
        className="template-matcher-form-input"
      />
      {open && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md">
          {loading && <div className="px-2 py-1.5 text-muted-foreground">正在加载 GEO 数据…</div>}
          {error && <div className="px-2 py-1.5 text-muted-foreground">无法加载建议列表，仍可手动输入</div>}
          {!loading && !error && !items.length && value && (
            <div className="px-2 py-1.5 text-muted-foreground">按 Enter 使用 “{value}”</div>
          )}
          {items.map((item, index) => (
            <button
              type="button"
              key={item}
              className={`block w-full rounded-sm px-2 py-1.5 text-left ${index === active ? 'bg-accent' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(item)
              }}
            >
              {geoLabel(item, catalogType)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
