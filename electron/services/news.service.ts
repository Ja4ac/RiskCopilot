// ============================================================
// NewsService — news item queries with asset linking
// ============================================================

import { getDb } from '../db'
import type { NewsWithAsset, NewsItem, Importance } from '../../shared/types/database'
import type { IpcGetNewsPayload } from '../../shared/types/ipc'

export class NewsService {
  /**
   * Get news with optional filters (importance, asset_id, pagination)
   */
  getNews(filters?: IpcGetNewsPayload): { items: NewsWithAsset[]; total: number } {
    const db = getDb()

    const conditions: string[] = []
    const params: any[] = []

    if (filters?.importance) {
      conditions.push('n.importance = ?')
      params.push(filters.importance)
    }

    if (filters?.asset_id) {
      conditions.push('EXISTS (SELECT 1 FROM news_asset_links nal WHERE nal.news_id = n.id AND nal.asset_id = ?)')
      params.push(filters.asset_id)
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''
    const limit = filters?.limit ?? 50
    const offset = filters?.offset ?? 0

    // Get total count
    const countRow = db.prepare(`
      SELECT COUNT(DISTINCT n.id) AS total FROM news_items n
      ${whereClause}
    `).get(...params) as { total: number }

    // Get news items with linked assets
    const rows = db.prepare(`
      SELECT n.* FROM news_items n
      ${whereClause}
      ORDER BY n.published_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as NewsItem[]

    // For each news item, fetch linked assets
    const getLinks = db.prepare(`
      SELECT nal.*, a.symbol AS asset_symbol, a.name AS asset_name
      FROM news_asset_links nal
      INNER JOIN assets a ON nal.asset_id = a.id
      WHERE nal.news_id = ?
    `)

    const items: NewsWithAsset[] = rows.map((news) => {
      const links = getLinks.all(news.id) as any[]
      return {
        ...news,
        linked_assets: links.map((l: any) => ({
          asset_id: l.asset_id,
          asset_name: l.asset_name,
          asset_symbol: l.asset_symbol,
          relevance: l.relevance,
          event_type: l.event_type
        }))
      }
    })

    return { items, total: countRow.total }
  }

  /**
   * Get news specifically related to a given asset
   */
  getAssetNews(assetId: string, limit = 20): NewsWithAsset[] {
    const db = getDb()

    const rows = db.prepare(`
      SELECT DISTINCT n.* FROM news_items n
      INNER JOIN news_asset_links nal ON nal.news_id = n.id
      WHERE nal.asset_id = ?
      ORDER BY n.published_at DESC
      LIMIT ?
    `).all(assetId, limit) as NewsItem[]

    const getLinks = db.prepare(`
      SELECT nal.*, a.symbol AS asset_symbol, a.name AS asset_name
      FROM news_asset_links nal
      INNER JOIN assets a ON nal.asset_id = a.id
      WHERE nal.news_id = ?
    `)

    return rows.map((news) => {
      const links = getLinks.all(news.id) as any[]
      return {
        ...news,
        linked_assets: links.map((l: any) => ({
          asset_id: l.asset_id,
          asset_name: l.asset_name,
          asset_symbol: l.asset_symbol,
          relevance: l.relevance,
          event_type: l.event_type
        }))
      }
    })
  }
}
