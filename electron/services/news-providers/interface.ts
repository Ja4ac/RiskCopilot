// News Provider interface — abstract data source for news/sentiment data

import type { NewsItem, NewsAssetLink, Importance } from '../../../shared/types/database'

export interface INewsProvider {
  /** Unique provider identifier */
  readonly id: string
  readonly provider: string
  readonly name: string

  /** Fetch latest news items */
  fetchNews(options?: {
    limit?: number
    importance?: Importance
    since?: string
  }): Promise<NewsItem[]>

  /** Fetch news links (which assets are mentioned) */
  fetchNewsLinks(newsIds: string[]): Promise<NewsAssetLink[]>

  /** Check if the provider is reachable */
  healthCheck(): Promise<boolean>
}
