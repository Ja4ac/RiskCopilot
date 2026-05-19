import { getDb } from '../index'
import { v4 as uuidv4 } from 'uuid'
import type { Trade, TradeSide } from '../../../shared/types/database'

export function getAllByAsset(assetId: string): Trade[] {
  const db = getDb()
  return db.prepare('SELECT * FROM trades WHERE asset_id = ? ORDER BY trade_time DESC').all(assetId) as Trade[]
}

export function getAll(): Trade[] {
  const db = getDb()
  return db.prepare('SELECT * FROM trades ORDER BY trade_time DESC').all() as Trade[]
}

export function getById(id: string): Trade | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM trades WHERE id = ?').get(id) as Trade | undefined
}

export interface CreateTradeData {
  asset_id: string
  account_id?: string
  side: TradeSide
  quantity: number
  price: number
  fee?: number
  tax?: number
  trade_time: string
  source?: string
}

export function create(data: CreateTradeData): Trade {
  const db = getDb()
  const id = uuidv4()
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
  db.prepare(`
    INSERT INTO trades (id, asset_id, account_id, side, quantity, price, fee, tax, trade_time, source, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(
    id,
    data.asset_id,
    data.account_id ?? 'default',
    data.side,
    data.quantity,
    data.price,
    data.fee ?? 0,
    data.tax ?? 0,
    data.trade_time,
    data.source ?? 'manual',
    now
  )
  return getById(id)!
}

export function voidTrade(id: string): Trade | undefined {
  const db = getDb()
  const result = db.prepare("UPDATE trades SET status = 'voided' WHERE id = ?").run(id)
  if (result.changes === 0) return undefined
  return getById(id)
}

export function getDateRange(from: string, to: string): Trade[] {
  const db = getDb()
  return db.prepare(
    'SELECT * FROM trades WHERE trade_time >= ? AND trade_time <= ? ORDER BY trade_time'
  ).all(from, to) as Trade[]
}
