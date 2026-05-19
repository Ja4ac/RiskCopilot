import { getDb } from '../index'
import { v4 as uuidv4 } from 'uuid'
import type { Position } from '../../../shared/types/database'

export function getAll(): Position[] {
  const db = getDb()
  return db.prepare('SELECT * FROM positions ORDER BY market_value DESC').all() as Position[]
}

export function getByAssetId(assetId: string): Position | undefined {
  const db = getDb()
  return db.prepare(
    'SELECT * FROM positions WHERE asset_id = ? AND account_id = ?'
  ).get(assetId, 'default') as Position | undefined
}

export interface UpsertPositionData {
  asset_id: string
  account_id?: string
  quantity: number
  avg_cost: number
  cost_amount: number
  market_value?: number
  unrealized_pnl?: number
}

export function upsert(data: UpsertPositionData): Position {
  const db = getDb()
  const accountId = data.account_id ?? 'default'
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const existing = db.prepare(
    'SELECT id FROM positions WHERE asset_id = ? AND account_id = ?'
  ).get(data.asset_id, accountId) as { id: string } | undefined

  if (existing) {
    db.prepare(`
      UPDATE positions SET
        quantity = ?, avg_cost = ?, cost_amount = ?, market_value = ?,
        unrealized_pnl = ?, updated_at = ?
      WHERE id = ?
    `).run(
      data.quantity,
      data.avg_cost,
      data.cost_amount,
      data.market_value ?? 0,
      data.unrealized_pnl ?? 0,
      now,
      existing.id
    )
    return getByAssetId(data.asset_id)!
  }

  const id = uuidv4()
  db.prepare(`
    INSERT INTO positions (id, asset_id, account_id, quantity, avg_cost, cost_amount, market_value, unrealized_pnl, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.asset_id,
    accountId,
    data.quantity,
    data.avg_cost,
    data.cost_amount,
    data.market_value ?? 0,
    data.unrealized_pnl ?? 0,
    now
  )
  return getByAssetId(data.asset_id)!
}

export function remove(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM positions WHERE id = ?').run(id)
  return result.changes > 0
}

export function getTotalValue(): number {
  const db = getDb()
  const row = db.prepare('SELECT COALESCE(SUM(market_value), 0) as total FROM positions').get() as { total: number }
  return row.total
}

export function recalculateAll(): void {
  const db = getDb()
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)

  const trades = db.prepare(
    "SELECT * FROM trades WHERE status = 'active' ORDER BY trade_time"
  ).all() as { asset_id: string; side: string; quantity: number; price: number }[]

  const byAsset = new Map<string, { buyQty: number; buyCost: number; sellQty: number }>()
  for (const t of trades) {
    let entry = byAsset.get(t.asset_id)
    if (!entry) {
      entry = { buyQty: 0, buyCost: 0, sellQty: 0 }
      byAsset.set(t.asset_id, entry)
    }
    if (t.side === 'buy') {
      entry.buyQty += t.quantity
      entry.buyCost += t.quantity * t.price
    } else {
      entry.sellQty += t.quantity
    }
  }

  for (const [assetId, entry] of byAsset) {
    const qty = entry.buyQty - entry.sellQty
    if (qty <= 0) {
      db.prepare('DELETE FROM positions WHERE asset_id = ?').run(assetId)
      continue
    }
    const avgCost = entry.buyCost / entry.buyQty
    const costAmount = avgCost * qty

    const existing = db.prepare(
      'SELECT id FROM positions WHERE asset_id = ? AND account_id = ?'
    ).get(assetId, 'default') as { id: string } | undefined

    if (existing) {
      db.prepare(`
        UPDATE positions SET quantity = ?, avg_cost = ?, cost_amount = ?, updated_at = ?
        WHERE id = ?
      `).run(qty, avgCost, costAmount, now, existing.id)
    } else {
      const id = uuidv4()
      db.prepare(`
        INSERT INTO positions (id, asset_id, account_id, quantity, avg_cost, cost_amount, market_value, unrealized_pnl, updated_at)
        VALUES (?, ?, 'default', ?, ?, ?, 0, 0, ?)
      `).run(id, assetId, qty, avgCost, costAmount, now)
    }
  }
}
