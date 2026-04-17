import { useState, useEffect, useCallback } from 'react'
import { Moon, Sun } from 'lucide-react'
import { cn } from '../lib/utils'

export function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false
    const stored = localStorage.getItem('theme')
    if (stored) return stored === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    const root = document.documentElement
    if (dark) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  const toggle = useCallback(() => {
    setDark(prev => !prev)
  }, [])

  return (
    <button
      onClick={toggle}
      className={cn(
        'inline-flex items-center justify-center rounded-md p-2',
        'text-muted-foreground hover:text-foreground',
        'hover:bg-muted transition-colors',
      )}
      aria-label="切換深色模式"
    >
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  )
}
