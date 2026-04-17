import { NavLink } from 'react-router-dom'
import {
  BarChart3,
  Newspaper,
  BookOpen,
  MessageCircle,
  Lock,
  ChevronLeft,
} from 'lucide-react'
import { cn } from '../lib/utils'
import type { UserLevel } from '../lib/auth'
import { canAccess } from '../lib/auth'

interface NavItem {
  readonly label: string
  readonly path: string
  readonly icon: React.ReactNode
  readonly requiredLevel: UserLevel
}

const NAV_ITEMS: readonly NavItem[] = [
  { label: '總覽', path: '/', icon: <BarChart3 className="h-5 w-5" />, requiredLevel: 'guest' },
  { label: '卡片', path: '/cards', icon: <Newspaper className="h-5 w-5" />, requiredLevel: 'member' },
  { label: 'Wiki', path: '/wiki', icon: <BookOpen className="h-5 w-5" />, requiredLevel: 'member' },
  { label: 'Chat', path: '/chat', icon: <MessageCircle className="h-5 w-5" />, requiredLevel: 'vip' },
]

interface SidebarProps {
  readonly userLevel: UserLevel
  readonly collapsed: boolean
  readonly onToggle: () => void
}

export function Sidebar({ userLevel, collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      className={cn(
        'flex flex-col border-r border-border bg-card transition-all duration-300',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <div className="flex items-center justify-between p-4">
        {!collapsed && (
          <span className="text-lg font-bold tracking-tight text-foreground">
            Insurance KB
          </span>
        )}
        <button
          onClick={onToggle}
          className={cn(
            'inline-flex items-center justify-center rounded-md p-1.5',
            'text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
            collapsed && 'mx-auto',
          )}
          aria-label={collapsed ? '展開側邊欄' : '收合側邊欄'}
        >
          <ChevronLeft
            className={cn('h-5 w-5 transition-transform', collapsed && 'rotate-180')}
          />
        </button>
      </div>

      <nav className="flex-1 space-y-1 px-2 py-2">
        {NAV_ITEMS.map(item => {
          const accessible = canAccess(item.requiredLevel, userLevel)
          return (
            <NavLink
              key={item.path}
              to={accessible ? item.path : '#'}
              onClick={e => {
                if (!accessible) e.preventDefault()
              }}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive && accessible
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                  !accessible && 'opacity-50 cursor-not-allowed',
                  collapsed && 'justify-center px-2',
                )
              }
            >
              {item.icon}
              {!collapsed && (
                <>
                  <span className="flex-1">{item.label}</span>
                  {!accessible && <Lock className="h-3.5 w-3.5" />}
                </>
              )}
            </NavLink>
          )
        })}
      </nav>

      {!collapsed && (
        <div className="border-t border-border p-4">
          <p className="text-xs text-muted-foreground">
            Insurance Knowledge Base v2
          </p>
        </div>
      )}
    </aside>
  )
}
