// ============================================================
// TradeService — add, update, void, query trades
// ============================================================

import { v4 as uuid } from 'uuid'
import { getDb } from '../../db'
import type { Trade } from '../../../shared/types/database'
import type { IpcAddTradePayload } from '../../../shared/types/ipc'

export class TradeService {
  private recalculatePosition: (assetId: string, accountId: string) => void
  private recordDailyPortfolioValue: (date?: string) => void

  constructor(
    recalculatePosition: (assetId: string, accountId: string) => void,
    recordDailyPortfolioValue: (date?: string) => void
  ) {
    this.recalculatePosition = recalculatePosition
    this.recordDailyPortfolioValue = recordDailyPortfolioValue
  }

  /**
   * Add a trade and recalculate the position
   */
  addTrade(payload: IpcAddTradePayload): Trade {
    const db = getDb()
    const tradeId = uuid()

    // Normalize asset_id — caller (IPC handler) should have already resolved it
    const assetId = payload.asset_id
    if (!assetId) {
      throw new Error('asset_id is required')
    }
    const fee = payload.fee ?? 0
    const tax = payload.tax ?? 0

    const trade: Trade = {
      id: tradeId,
      asset_id: assetId,
      account_id: payload.account_id,
      side: payload.side,
      quantity: payload.quantity,
      price: payload.price,
      fee,
      tax,
      trade_time: payload.trade_time,
      source: payload.source ?? 'manual',
      status: 'active',
      created_at: new Date().toISOString()
    }

    db.prepare(`
      INSERT INTO trades (id, asset_id, account_id, side, quantity, price, fee, tax, trade_time, source, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      trade.id, trade.asset_id, trade.account_id, trade.side,
      trade.quantity, trade.price, trade.fee, trade.tax,
      trade.trade_time, trade.source, trade.status, trade.created_at
    )

    // Recalculate position
    this.recalculatePosition(assetId, payload.account_id)

    // Record daily portfolio snapshot (use trade date for accurate history)
    this.recordDailyPortfolioValue(trade.trade_time.slice(0, 10))

    return trade
  }

  /**
   * Update a trade and recalculate the position
   */
  updateTrade(tradeId: string, updates: Partial<IpcAddTradePayload>): Trade | null {
    const db = getDb()

    const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(tradeId) as Trade | undefined
    if (!trade) return null

    const allowedFields = ['side', 'quantity', 'price', 'fee', 'tax', 'trade_time']
    const setClauses: string[] = []
    const values: unknown[] = []

    for (const key of allowedFields) {
      if (key in updates) {
        setClauses.push(`${key} = ?`)
        values.push((updates as Record<string, unknown>)[key])
      }
    }

    if (setClauses.length === 0) return trade

    values.push(tradeId)
    db.prepare(`UPDATE trades SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)

    console.log(`[updateTrade] Trade ${tradeId} updated. Fields: ${setClauses.join(', ')}`)

    // Recalculate position
    this.recalculatePosition(trade.asset_id, trade.account_id)

    // Record daily portfolio snapshot
    this.recordDailyPortfolioValue()

    return { ...trade, ...updates }
  }

  /**
   * Void a trade and recalculate the position
   */
  voidTrade(tradeId: string): Trade | null {
    const db = getDb()

    const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(tradeId) as Trade | undefined
    if (!trade) return null

    db.prepare('UPDATE trades SET status = ? WHERE id = ?').run('voided', tradeId)

    // Recalculate position
    this.recalculatePosition(trade.asset_id, trade.account_id)

    // Record daily portfolio snapshot
    this.recordDailyPortfolioValue()

    return { ...trade, status: 'voided' }
  }

  /**
   * Get trades, optionally filtered by asset
   */
  getTrades(assetId?: string): Trade[] {
    const db = getDb()

    const rows = assetId
      ? db.prepare(`
          SELECT t.*, a.id AS a_id, a.symbol, a.market, a.name, a.asset_type, a.currency,
                 a.industry, a.style, a.exchange, a.created_at AS a_created_at, a.updated_at AS a_updated_at
          FROM trades t
          JOIN assets a ON t.asset_id = a.id
          WHERE t.asset_id = ?
          ORDER BY t.trade_time DESC
        `).all(assetId)
      : db.prepare(`
          SELECT t.*, a.id AS a_id, a.symbol, a.market, a.name, a.asset_type, a.currency,
                 a.industry, a.style, a.exchange, a.created_at AS a_created_at, a.updated_at AS a_updated_at
          FROM trades t
          JOIN assets a ON t.asset_id = a.id
          ORDER BY t.trade_time DESC
        `).all()

    return (rows as any[]).map((row) => {
      const trade: Trade = {
        id: row.id,
        asset_id: row.asset_id,
        account_id: row.account_id,
        side: row.side,
        quantity: row.quantity,
        price: row.price,
        fee: row.fee,
        tax: row.tax,
        trade_time: row.trade_time,
        source: row.source,
        status: row.status,
        created_at: row.created_at,
        asset: {
          symbol: row.symbol,
          market: row.market,
          name: row.name,
          asset_type: row.asset_type,
        },
      }
      return trade
    })
  }
}
