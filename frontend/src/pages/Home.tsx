import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Shield, Newspaper, BookOpen, MessageCircle } from 'lucide-react'
import { cn } from '../lib/utils'
import { StatsBar } from '../components/StatsBar'
import { ArticleCard } from '../components/ArticleCard'
import { sampleArticles } from '../data/sample'

const FEATURES = [
  {
    icon: <Newspaper className="h-5 w-5" />,
    title: '每日新聞卡片',
    description: '全球保險產業新聞，AI 分類整理',
  },
  {
    icon: <BookOpen className="h-5 w-5" />,
    title: 'Wiki 知識蒸餾',
    description: '將新聞轉化為結構化知識條目',
  },
  {
    icon: <MessageCircle className="h-5 w-5" />,
    title: 'AI 智能問答',
    description: 'RAG 驅動的保險知識問答系統',
  },
] as const

export function Home() {
  const todayArticles = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const todayItems = sampleArticles.filter(a => a.date === today)
    return todayItems.length > 0 ? todayItems.slice(0, 6) : sampleArticles.slice(0, 6)
  }, [])

  const uniqueSources = useMemo(() => {
    const sources = new Set(sampleArticles.map(a => a.source))
    return sources.size
  }, [])

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 lg:px-8 space-y-12">
      {/* Hero */}
      <div className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
          <Shield className="h-4 w-4" />
          Insurance Knowledge Base v2
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          保險產業智能知識庫
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
          匯集全球保險產業新聞與分析，透過 AI 技術進行分類、蒸餾與知識圖譜建構，
          為保險從業人員提供即時、全面的產業洞察。
        </p>
      </div>

      {/* Stats */}
      <StatsBar
        totalArticles={sampleArticles.length}
        todayCount={todayArticles.length}
        sourceCount={uniqueSources}
      />

      {/* Today's articles */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-foreground">今日焦點</h2>
          <Link
            to="/cards"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
          >
            查看全部
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {todayArticles.map(article => (
            <ArticleCard key={article.id} article={article} />
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="rounded-2xl border border-border bg-card p-8 text-center space-y-6">
        <h2 className="text-2xl font-bold text-card-foreground">
          登入解鎖全部功能
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-2xl mx-auto">
          {FEATURES.map(feature => (
            <div key={feature.title} className="space-y-2">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                {feature.icon}
              </div>
              <h3 className="font-medium text-card-foreground">{feature.title}</h3>
              <p className="text-sm text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>
        <button
          className={cn(
            'inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-medium',
            'bg-primary text-primary-foreground hover:bg-primary/90',
            'transition-colors',
          )}
        >
          免費註冊
          <ArrowRight className="h-4 w-4" />
        </button>
      </section>
    </div>
  )
}
