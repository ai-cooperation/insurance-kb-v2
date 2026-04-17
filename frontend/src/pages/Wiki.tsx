import { useState } from 'react'
import {
  BookOpen,
  ChevronRight,
  Building2,
  ShieldCheck,
  TrendingUp,
  Cpu,
  Leaf,
  Users,
  Scale,
  Globe,
} from 'lucide-react'
import { cn } from '../lib/utils'

interface TopicNode {
  readonly id: string
  readonly label: string
  readonly icon: React.ReactNode
  readonly children?: readonly TopicNode[]
}

const TOPIC_TREE: readonly TopicNode[] = [
  {
    id: 'regulation',
    label: '監管與合規',
    icon: <Scale className="h-4 w-4" />,
    children: [
      { id: 'reg-tw', label: '台灣金管會', icon: <ChevronRight className="h-3 w-3" /> },
      { id: 'reg-cn', label: '中國銀保監', icon: <ChevronRight className="h-3 w-3" /> },
      { id: 'reg-eu', label: '歐盟 Solvency II / DORA', icon: <ChevronRight className="h-3 w-3" /> },
      { id: 'reg-us', label: '美國 NAIC', icon: <ChevronRight className="h-3 w-3" /> },
    ],
  },
  {
    id: 'products',
    label: '產品與市場',
    icon: <Building2 className="h-4 w-4" />,
    children: [
      { id: 'prod-life', label: '壽險', icon: <ChevronRight className="h-3 w-3" /> },
      { id: 'prod-pnc', label: '產險', icon: <ChevronRight className="h-3 w-3" /> },
      { id: 'prod-health', label: '健康險', icon: <ChevronRight className="h-3 w-3" /> },
      { id: 'prod-parametric', label: '參數型保險', icon: <ChevronRight className="h-3 w-3" /> },
    ],
  },
  {
    id: 'reinsurance',
    label: '再保市場',
    icon: <ShieldCheck className="h-4 w-4" />,
    children: [
      { id: 'rei-rates', label: '費率趨勢', icon: <ChevronRight className="h-3 w-3" /> },
      { id: 'rei-cat', label: '巨災風險', icon: <ChevronRight className="h-3 w-3" /> },
      { id: 'rei-ils', label: 'ILS / Cat Bond', icon: <ChevronRight className="h-3 w-3" /> },
    ],
  },
  {
    id: 'technology',
    label: '科技應用',
    icon: <Cpu className="h-4 w-4" />,
    children: [
      { id: 'tech-ai', label: 'AI / 機器學習', icon: <ChevronRight className="h-3 w-3" /> },
      { id: 'tech-blockchain', label: '區塊鏈', icon: <ChevronRight className="h-3 w-3" /> },
      { id: 'tech-iot', label: 'IoT / 穿戴裝置', icon: <ChevronRight className="h-3 w-3" /> },
      { id: 'tech-embedded', label: '嵌入式保險', icon: <ChevronRight className="h-3 w-3" /> },
    ],
  },
  {
    id: 'esg',
    label: 'ESG 永續',
    icon: <Leaf className="h-4 w-4" />,
    children: [
      { id: 'esg-climate', label: '氣候風險', icon: <ChevronRight className="h-3 w-3" /> },
      { id: 'esg-invest', label: 'ESG 投資', icon: <ChevronRight className="h-3 w-3" /> },
      { id: 'esg-report', label: '永續報告', icon: <ChevronRight className="h-3 w-3" /> },
    ],
  },
  {
    id: 'market',
    label: '市場趨勢',
    icon: <TrendingUp className="h-4 w-4" />,
    children: [
      { id: 'mkt-ma', label: '併購動態', icon: <ChevronRight className="h-3 w-3" /> },
      { id: 'mkt-emerging', label: '新興市場', icon: <ChevronRight className="h-3 w-3" /> },
    ],
  },
  {
    id: 'talent',
    label: '人才與組織',
    icon: <Users className="h-4 w-4" />,
  },
  {
    id: 'consumer',
    label: '消費者保護',
    icon: <Globe className="h-4 w-4" />,
  },
]

export function Wiki() {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set(['regulation']))
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <div className="flex h-full">
      {/* Topic sidebar */}
      <div className="w-72 border-r border-border bg-card overflow-y-auto scrollbar-thin p-4 space-y-1 hidden md:block">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          主題分類
        </h2>
        {TOPIC_TREE.map(topic => (
          <div key={topic.id}>
            <button
              onClick={() => {
                if (topic.children) {
                  toggleExpand(topic.id)
                }
                setSelectedId(topic.id)
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                selectedId === topic.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:bg-muted',
              )}
            >
              {topic.icon}
              <span className="flex-1 text-left">{topic.label}</span>
              {topic.children && (
                <ChevronRight
                  className={cn(
                    'h-3.5 w-3.5 text-muted-foreground transition-transform',
                    expandedIds.has(topic.id) && 'rotate-90',
                  )}
                />
              )}
            </button>
            {topic.children && expandedIds.has(topic.id) && (
              <div className="ml-4 mt-0.5 space-y-0.5">
                {topic.children.map(child => (
                  <button
                    key={child.id}
                    onClick={() => setSelectedId(child.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors',
                      selectedId === child.id
                        ? 'text-primary font-medium'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {child.icon}
                    {child.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-4 max-w-md">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <BookOpen className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-2xl font-bold text-foreground">
            Wiki 蒸餾建置中
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            知識蒸餾系統正在開發中。此功能將自動從每日新聞中萃取結構化知識，
            建構保險產業知識圖譜，提供主題式的深度瀏覽體驗。
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            {['知識圖譜', '自動分類', '主題關聯', '時序追蹤'].map(tag => (
              <span
                key={tag}
                className="inline-flex rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
