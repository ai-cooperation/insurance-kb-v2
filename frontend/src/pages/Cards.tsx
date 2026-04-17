import { useState, useMemo } from 'react'
import { ArticleCard } from '../components/ArticleCard'
import { FilterBar, type FilterState } from '../components/FilterBar'
import { sampleArticles } from '../data/sample'

export function Cards() {
  const [filters, setFilters] = useState<FilterState>({
    category: '',
    region: '',
    search: '',
  })

  const filtered = useMemo(() => {
    return sampleArticles.filter(article => {
      if (filters.category && article.category !== filters.category) return false
      if (filters.region && article.region !== filters.region) return false
      if (filters.search) {
        const q = filters.search.toLowerCase()
        const searchable = [
          article.title,
          article.title_en ?? '',
          article.summary,
          article.source,
          ...article.keywords,
        ].join(' ').toLowerCase()
        if (!searchable.includes(q)) return false
      }
      return true
    })
  }, [filters])

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:px-8 space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground">新聞卡片</h1>
        <p className="text-sm text-muted-foreground">
          共 {filtered.length} 篇文章
          {filters.category || filters.region || filters.search
            ? `（已篩選，全部 ${sampleArticles.length} 篇）`
            : ''
          }
        </p>
      </div>

      <FilterBar filters={filters} onChange={setFilters} />

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-lg font-medium text-muted-foreground">
            沒有符合條件的文章
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            請調整篩選條件再試一次
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(article => (
            <ArticleCard key={article.id} article={article} />
          ))}
        </div>
      )}
    </div>
  )
}
