import { FileText, TrendingUp, Globe } from 'lucide-react'
import { cn } from '../lib/utils'

interface StatItem {
  readonly label: string
  readonly value: string | number
  readonly icon: React.ReactNode
}

interface StatsBarProps {
  readonly totalArticles: number
  readonly todayCount: number
  readonly sourceCount: number
}

export function StatsBar({ totalArticles, todayCount, sourceCount }: StatsBarProps) {
  const stats: readonly StatItem[] = [
    {
      label: '總文章數',
      value: totalArticles.toLocaleString(),
      icon: <FileText className="h-5 w-5 text-primary" />,
    },
    {
      label: '今日新增',
      value: todayCount,
      icon: <TrendingUp className="h-5 w-5 text-primary" />,
    },
    {
      label: '資料來源',
      value: sourceCount,
      icon: <Globe className="h-5 w-5 text-primary" />,
    },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {stats.map(stat => (
        <div
          key={stat.label}
          className={cn(
            'flex items-center gap-4 rounded-xl border border-border bg-card p-5',
            'transition-colors hover:border-primary/20',
          )}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            {stat.icon}
          </div>
          <div>
            <p className="text-2xl font-bold text-card-foreground">{stat.value}</p>
            <p className="text-sm text-muted-foreground">{stat.label}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
