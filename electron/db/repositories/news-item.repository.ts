import { getDb } from '../index'
import { v4 as uuidv4 } from 'uuid'
import type { NewsItem, Importance } from '../../../shared/types/database'

export interface NewsFilters {
  importance?: Importance
  limit?: number
  offset?: number
}

export function getAll(filters?: NewsFilters): NewsItem[] {
  const db = getDb()
  let sql = 'SELECT * FROM news_items'
  const params: (string | number)[] = []

  if (filters?.importance) {
    sql += ' WHERE importance = ?'
    params.push(filters.importance)
  }

  sql += ' ORDER BY published_at DESC'

  if (filters?.limit != null) {
    sql += ' LIMIT ?'
    params.push(filters.limit)
    if (filters?.offset != null) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }
  }

  return db.prepare(sql).all(...params) as NewsItem[]
}

export function getById(id: string): NewsItem | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM news_items WHERE id = ?').get(id) as NewsItem | undefined
}

export interface CreateNewsData {
  title: string
  summary?: string | null
  source: string
  url?: string | null
  published_at: string
  sentiment?: number | null
  importance?: Importance
  raw_hash: string
}

export function create(data: CreateNewsData): NewsItem {
  const db = getDb()
  const id = uuidv4()
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
  db.prepare(`
    INSERT INTO news_items (id, title, summary, source, url, published_at, sentiment, importance, raw_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.title,
    data.summary ?? null,
    data.source,
    data.url ?? null,
    data.published_at,
    data.sentiment ?? null,
    data.importance ?? 'low',
    data.raw_hash,
    now
  )
  return getById(id)!
}

export function search(query: string): NewsItem[] {
  const db = getDb()
  const like = `%${query}%`
  return db.prepare(
    'SELECT * FROM news_items WHERE title LIKE ? OR summary LIKE ? ORDER BY published_at DESC'
  ).all(like, like) as NewsItem[]
}

export function getByAssetId(assetId: string): NewsItem[] {
  const db = getDb()
  return db.prepare(`
    SELECT DISTINCT ni.* FROM news_items ni
    INNER JOIN news_asset_links nal ON ni.id = nal.news_id
    WHERE nal.asset_id = ?
    ORDER BY ni.published_at DESC
  `).all(assetId) as NewsItem[]
}
