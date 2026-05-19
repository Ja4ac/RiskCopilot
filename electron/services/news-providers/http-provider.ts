import type { NewsItem, NewsAssetLink, Importance } from '../../../shared/types/database'
import type { INewsProvider } from './interface'

/**
 * HTTP News Provider — fetches news from a custom HTTP API.
 *
 * Expected API contract (to be implemented by external service):
 *
 * GET /news?limit={limit}&importance={importance}&since={since}
 *   → { items: Array<{ id, title, summary, source, url, published_at, sentiment, importance }> }
 *
 * GET /news/links?news_ids=id1,id2
 *   → { links: Array<{ news_id, asset_id, relevance, event_type }> }
 *
 * GET /health
 *   → { status: 'ok' }
 */
export class HttpNewsProvider implements INewsProvider {
  readonly id: string
  readonly provider = 'http'
  readonly name: string
  private baseUrl: string

  constructor(id: string, name: string, baseUrl: string) {
    this.id = id
    this.name = name
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  async fetchNews(options?: { limit?: number; importance?: Importance; since?: string }): Promise<NewsItem[]> {
    const url = new URL(`${this.baseUrl}/news`)
    if (options?.limit) url.searchParams.set('limit', String(options.limit))
    if (options?.importance) url.searchParams.set('importance', options.importance)
    if (options?.since) url.searchParams.set('since', options.since)

    const res = await fetch(url.toString(), { timeout: 15000 } as any)
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)

    const data = await res.json() as Record<string, unknown>
    if (!Array.isArray(data.items)) throw new Error('Invalid response format: expected items array')
    return data.items as NewsItem[]
  }

  async fetchNewsLinks(newsIds: string[]): Promise<NewsAssetLink[]> {
    if (newsIds.length === 0) return []
    const url = new URL(`${this.baseUrl}/news/links`)
    url.searchParams.set('news_ids', newsIds.join(','))

    const res = await fetch(url.toString(), { timeout: 15000 } as any)
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)

    const data = await res.json() as Record<string, unknown>
    if (!Array.isArray(data.links)) throw new Error('Invalid response format: expected links array')
    return data.links as NewsAssetLink[]
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { timeout: 10000 } as any)
      if (!res.ok) return false
      const data = await res.json() as Record<string, unknown>
      return data.status === 'ok' || data.healthy === true
    } catch {
      return false
    }
  }
}
