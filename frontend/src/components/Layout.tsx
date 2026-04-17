import { useState, useEffect, useCallback } from 'react'
import { Outlet } from 'react-router-dom'
import { Search, User, Menu } from 'lucide-react'
import { cn } from '../lib/utils'
import { ThemeToggle } from './ThemeToggle'
import { Sidebar } from './Sidebar'
import { getUserLevel, getLevelLabel, type UserLevel } from '../lib/auth'

export function Layout() {
  const [userLevel, setUserLevel] = useState<UserLevel>('guest')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    getUserLevel().then(setUserLevel)
  }, [])

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => !prev)
  }, [])

  const toggleMobile = useCallback(() => {
    setMobileOpen(prev => !prev)
  }, [])

  const closeMobile = useCallback(() => {
    setMobileOpen(false)
  }, [])

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={closeMobile}
        />
      )}

      {/* Sidebar — desktop */}
      <div className="hidden lg:flex">
        <Sidebar
          userLevel={userLevel}
          collapsed={sidebarCollapsed}
          onToggle={toggleSidebar}
        />
      </div>

      {/* Sidebar — mobile */}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-50 lg:hidden transition-transform duration-300',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <Sidebar
          userLevel={userLevel}
          collapsed={false}
          onToggle={closeMobile}
        />
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-14 items-center gap-4 border-b border-border bg-card px-4 lg:px-6">
          <button
            onClick={toggleMobile}
            className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:text-foreground hover:bg-muted lg:hidden"
            aria-label="開啟選單"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜尋文章..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className={cn(
                'w-full rounded-lg border border-border bg-background py-2 pl-9 pr-4 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary',
                'transition-colors',
              )}
            />
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <div
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-1.5',
                'border border-border text-sm',
              )}
            >
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">
                {userLevel === 'guest' ? '登入' : getLevelLabel(userLevel)}
              </span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
