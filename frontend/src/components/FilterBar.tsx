import { Search, X } from 'lucide-react'
import { cn, CATEGORIES, REGIONS } from '../lib/utils'

interface FilterState {
  readonly category: string
  readonly region: string
  readonly search: string
}

interface FilterBarProps {
  readonly filters: FilterState
  readonly onChange: (filters: FilterState) => void
}

export function FilterBar({ filters, onChange }: FilterBarProps) {
  const hasFilters = filters.category !== '' || filters.region !== '' || filters.search !== ''

  const updateFilter = (key: keyof FilterState, value: string) => {
    onChange({ ...filters, [key]: value })
  }

  const clearAll = () => {
    onChange({ category: '', region: '', search: '' })
  }

  const selectClasses = cn(
    'rounded-lg border border-border bg-background px-3 py-2 text-sm',
    'text-foreground',
    'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary',
    'transition-colors',
  )

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Category */}
      <select
        value={filters.category}
        onChange={e => updateFilter('category', e.target.value)}
        className={selectClasses}
      >
        <option value="">所有分類</option>
        {CATEGORIES.map(cat => (
          <option key={cat} value={cat}>{cat}</option>
        ))}
      </select>

      {/* Region */}
      <select
        value={filters.region}
        onChange={e => updateFilter('region', e.target.value)}
        className={selectClasses}
      >
        <option value="">所有地區</option>
        {REGIONS.map(region => (
          <option key={region} value={region}>{region}</option>
        ))}
      </select>

      {/* Search */}
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="篩選關鍵字..."
          value={filters.search}
          onChange={e => updateFilter('search', e.target.value)}
          className={cn(
            'w-full rounded-lg border border-border bg-background py-2 pl-9 pr-4 text-sm',
            'placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary',
            'transition-colors',
          )}
        />
      </div>

      {/* Clear */}
      {hasFilters && (
        <button
          onClick={clearAll}
          className={cn(
            'inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm',
            'text-muted-foreground hover:text-foreground hover:bg-muted',
            'transition-colors',
          )}
        >
          <X className="h-3.5 w-3.5" />
          清除篩選
        </button>
      )}
    </div>
  )
}

export type { FilterState }
