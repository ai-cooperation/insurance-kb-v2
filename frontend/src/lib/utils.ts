import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import { zhTW } from 'date-fns/locale'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(dateStr: string): string {
  try {
    const date = parseISO(dateStr)
    return format(date, 'yyyy/MM/dd')
  } catch {
    return dateStr
  }
}

export function formatRelativeDate(dateStr: string): string {
  try {
    const date = parseISO(dateStr)
    return formatDistanceToNow(date, { addSuffix: true, locale: zhTW })
  } catch {
    return dateStr
  }
}

export const CATEGORY_COLORS: Record<string, string> = {
  '監管動態': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  '產品創新': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  '市場趨勢': 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  '科技應用': 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  '再保市場': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  'ESG永續': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  '消費者保護': 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  '人才與組織': 'bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200',
}

export const REGIONS = [
  '全球', '台灣', '中國', '美國', '歐洲', '日本', '東南亞', '其他'
] as const

export const CATEGORIES = Object.keys(CATEGORY_COLORS)
