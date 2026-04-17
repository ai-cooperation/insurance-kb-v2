export interface Article {
  readonly id: string
  readonly title: string
  readonly title_en?: string
  readonly summary: string
  readonly category: string
  readonly region: string
  readonly source: string
  readonly url: string
  readonly date: string
  readonly importance: 'high' | 'medium' | 'low'
  readonly keywords: readonly string[]
}
