import { getDb } from '../index'
import { v4 as uuidv4 } from 'uuid'
import type { Asset, Market, AssetType } from '../../../shared/types/database'
import { guessMarket } from '../../utils/market-detection'

/**
 * Resolve asset_type from stock_listings matching both symbol and market.
 * Returns undefined if no listing found — caller falls back to 'stock'.
 */
function resolveAssetType(symbol: string, market: string): string | undefined {
  try {
    const db = getDb()
    const row = db.prepare(
      `SELECT asset_type FROM stock_listings WHERE symbol = ? AND market = ? AND is_active = 1 LIMIT 1`
    ).get(symbol, market) as { asset_type: string } | undefined
    return row?.asset_type
  } catch {
    return undefined
  }
}

export function getAll(): Asset[] {
  const db = getDb()
  return db.prepare('SELECT * FROM assets ORDER BY market, symbol').all() as Asset[]
}

export function getById(id: string): Asset | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as Asset | undefined
}

export function getBySymbol(symbol: string, market: Market): Asset | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM assets WHERE symbol = ? AND market = ?').get(symbol, market) as Asset | undefined
}

/**
 * Upsert an asset by symbol + market.
 * If the asset doesn't exist, creates it. Returns the asset.
 */
export function upsert(params: {
  symbol: string
  market: string
  name?: string
  asset_type?: string
  currency?: string
}): Asset {
  const db = getDb()
  // Clean symbol: strip trailing dots/spaces
  const cleanSymbol = params.symbol.trim().replace(/\.+$/, '')
  const marketVal = guessMarket(cleanSymbol, params.market) as Market
  const existing = getBySymbol(cleanSymbol, marketVal)
  if (existing) {
    // Update name/asset_type if caller provides better data
    // (asset may have been created without proper metadata)
    const updates: string[] = []
    const vals: unknown[] = []
    if (params.name && params.name !== existing.name) {
      updates.push('name = ?'); vals.push(params.name)
    }
    if (params.asset_type && params.asset_type !== existing.asset_type) {
      updates.push('asset_type = ?'); vals.push(params.asset_type)
    }
    if (updates.length > 0) {
      const now = new Date().toISOString()
      updates.push('updated_at = ?'); vals.push(now)
      vals.push(existing.id)
      db.prepare(`UPDATE assets SET ${updates.join(', ')} WHERE id = ?`).run(...vals)
    }
    return existing
  }

  const id = uuidv4()
  const now = new Date().toISOString()
  const name = params.name || cleanSymbol

  db.prepare(`
    INSERT INTO assets (id, symbol, market, name, asset_type, currency, industry, style, exchange, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
  `).run(
    id,
    cleanSymbol,
    marketVal,
    name,
    params.asset_type || resolveAssetType(cleanSymbol, marketVal) || 'stock',
    params.currency || 'CNY',
    now,
    now
  )

  return getById(id)!
}

export function create(data: Omit<Asset, 'id' | 'created_at' | 'updated_at'>): Asset {
  const db = getDb()
  const id = uuidv4()
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
  db.prepare(`
    INSERT INTO assets (id, symbol, market, name, asset_type, currency, industry, style, exchange, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.symbol,
    data.market,
    data.name,
    data.asset_type,
    data.currency,
    data.industry ?? null,
    data.style ?? null,
    data.exchange ?? null,
    now,
    now
  )
  return getById(id)!
}

export function update(id: string, data: Partial<Omit<Asset, 'id' | 'created_at' | 'updated_at'>>): Asset | undefined {
  const db = getDb()
  const existing = getById(id)
  if (!existing) return undefined

  db.prepare(`
    UPDATE assets SET
      symbol = ?, market = ?, name = ?, asset_type = ?, currency = ?,
      industry = ?, style = ?, exchange = ?,
      updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(
    data.symbol ?? existing.symbol,
    data.market ?? existing.market,
    data.name ?? existing.name,
    data.asset_type ?? existing.asset_type,
    data.currency ?? existing.currency,
    data.industry ?? existing.industry,
    data.style ?? existing.style,
    data.exchange ?? existing.exchange,
    id
  )
  return getById(id)
}

export function remove(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM assets WHERE id = ?').run(id)
  return result.changes > 0
}

// ---- Helpers re-exported from utils/market-detection ----
