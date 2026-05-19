import { getDb } from '../index'
import { v4 as uuidv4 } from 'uuid'
import type { NewsAssetLink } from '../../../shared/types/database'

export function getByNewsId(newsId: string): NewsAssetLink[] {
  const db = getDb()
  return db.prepare('SELECT * FROM news_asset_links WHERE news_id = ?').all(newsId) as NewsAssetLink[]
}

export function getByAssetId(assetId: string): NewsAssetLink[] {
  const db = getDb()
  return db.prepare('SELECT * FROM news_asset_links WHERE asset_id = ?').all(assetId) as NewsAssetLink[]
}

export interface CreateLinkData {
  news_id: string
  asset_id: string
  relevance: number
  event_type?: string | null
}

export function create(data: CreateLinkData): NewsAssetLink {
  const db = getDb()
  const id = uuidv4()
  db.prepare(`
    INSERT INTO news_asset_links (id, news_id, asset_id, relevance, event_type)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, data.news_id, data.asset_id, data.relevance, data.event_type ?? null)
  return db.prepare('SELECT * FROM news_asset_links WHERE id = ?').get(id) as NewsAssetLink
}
