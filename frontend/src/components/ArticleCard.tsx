import { useState, useCallback } from 'react'
import { ExternalLink, ChevronDown, MapPin, Calendar } from 'lucide-react'
import { cn, CATEGORY_COLORS, formatDate } from '../lib/utils'
import type { Article } from '../types/article'

interface ArticleCardProps {
  readonly article: Article
}

const IMPORTANCE_STYLES: Record<Article['importance'], string> = {
  high: 'bg-red-500',
  medium: 'bg-amber-500',
  low: 'bg-gray-400 dark:bg-gray-600',
}

const IMPORTANCE_LABELS: Record<Article['importance'], string> = {
  high: '高',
  medium: '中',
  low: '低',
}

export function ArticleCard({ article }: ArticleCardProps) {
  const [expanded, setExpanded] = useState(false)

  const toggle = useCallback(() => {
    setExpanded(prev => !prev)
  }, [])

  const categoryColor = CATEGORY_COLORS[article.category] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'

  return (
    <div
      className={cn(
        'group rounded-xl border border-border bg-card p-5',
        'hover:shadow-md hover:border-primary/20',
        'transition-all duration-200',
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 text-xs mb-3">
        <span className={cn('inline-flex rounded-full px-2.5 py-0.5 font-medium', categoryColor)}>
          {article.category}
        </span>
        <span className="text-muted-foreground flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          {article.region}
        </span>
        <span className="ml-auto text-muted-foreground flex items-center gap-1">
          <Calendar className="h-3 w-3" />
          {formatDate(article.date)}
        </span>
      </div>

      {/* Title */}
      <h3 className="font-semibold text-card-foreground leading-snug mb-1">
        {article.title}
      </h3>
      {article.title_en && (
        <p className="text-xs text-muted-foreground mb-3">
          {article.title_en}
        </p>
      )}

      {/* Summary */}
      <p
        className={cn(
          'text-sm text-muted-foreground leading-relaxed',
          !expanded && 'line-clamp-2',
        )}
      >
        {article.summary}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className={cn('inline-block h-2 w-2 rounded-full', IMPORTANCE_STYLES[article.importance])} />
            重要性：{IMPORTANCE_LABELS[article.importance]}
          </span>
          <span>
            {article.source}
          </span>
        </div>
        <button
          onClick={toggle}
          className={cn(
            'inline-flex items-center gap-1 text-xs font-medium',
            'text-primary hover:text-primary/80 transition-colors',
          )}
        >
          {expanded ? '收合' : '展開'}
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')}
          />
        </button>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="mt-4 space-y-3 animate-in slide-in-from-top-2 duration-200">
          {/* Keywords */}
          {article.keywords.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {article.keywords.map(kw => (
                <span
                  key={kw}
                  className="inline-flex rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {kw}
                </span>
              ))}
            </div>
          )}

          {/* Link */}
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium',
              'bg-primary text-primary-foreground hover:bg-primary/90',
              'transition-colors',
            )}
          >
            閱讀原文
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      )}
    </div>
  )
}
