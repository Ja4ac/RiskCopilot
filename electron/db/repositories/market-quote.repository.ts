import { getDb } from '../index'
import { v4 as uuidv4 } from 'uuid'
import type { MarketQuote } from '../../../shared/types/database'

export function getLatest(assetId: string): MarketQuote | undefined {
  const db = getDb()
  return db.prepare(
    'SELECT * FROM market_quotes WHERE asset_id = ? ORDER BY quote_time DESC LIMIT 1'
  ).get(assetId) as MarketQuote | undefined
}

export function getLatestAll(): MarketQuote[] {
  const db = getDb()
  return db.prepare(`
    SELECT mq.* FROM market_quotes mq
    INNER JOIN (
      SELECT asset_id, MAX(quote_time) as max_time
      FROM market_quotes
      GROUP BY asset_id
    ) latest ON mq.asset_id = latest.asset_id AND mq.quote_time = latest.max_time
  `).all() as MarketQuote[]
}

export interface UpsertQuoteData {
  asset_id: string
  price: number
  change_pct?: number | null
  volume?: number | null
  turnover?: number | null
  quote_time: string
  source?: string
}

export function upsert(data: UpsertQuoteData): MarketQuote {
  const db = getDb()
  const id = uuidv4()
  db.prepare(`
    INSERT INTO market_quotes (id, asset_id, price, change_pct, volume, turnover, quote_time, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.asset_id,
    data.price,
    data.change_pct ?? null,
    data.volume ?? null,
    data.turnover ?? null,
    data.quote_time,
    data.source ?? 'simulated'
  )
  return getLatest(data.asset_id)!
}

export function getHistory(assetId: string, limit: number): MarketQuote[] {
  const db = getDb()
  return db.prepare(
    'SELECT * FROM market_quotes WHERE asset_id = ? ORDER BY quote_time DESC LIMIT ?'
  ).all(assetId, limit) as MarketQuote[]
}
