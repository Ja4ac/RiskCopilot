import { getDb } from '../index'
import { v4 as uuidv4 } from 'uuid'
import type { Asset, Market, AssetType } from '../../../shared/types/database'
import { guessMarket, guessAssetType } from '../../utils/market-detection'

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
  if (existing) return existing

  const id = uuidv4()
  const now = new Date().toISOString()
  const name = params.name || params.symbol

  db.prepare(`
    INSERT INTO assets (id, symbol, market, name, asset_type, currency, industry, style, exchange, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
  `).run(
    id,
    cleanSymbol,
    marketVal,
    name,
    params.asset_type || guessAssetType(cleanSymbol),
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
