import { getDb } from '../db'
import { v4 as uuid } from 'uuid'
import type { WatchlistItem, WatchlistItemWithStatus, MarketQuote, DataQualityStatus, Asset } from '../../shared/types/database'

/**
 * WatchlistService — manages user's tracked instruments.
 *
 * Rules:
 *   - Add: upsert asset + create watchlist item. Auto-add on trade import.
 *   - Remove: only allowed if positions.quantity == 0. Otherwise archive (is_visible=0).
 *   - List: returns watchlist items joined with assets, positions, and latest quotes.
 *   - Holdings status is derived from positions.quantity > 0, not stored.
 */
export class WatchlistService {
  /**
   * Add an asset to the watchlist. Creates asset if it doesn't exist.
   */
  async add(
    symbol: string,
    market: string,
    name?: string,
    assetType?: string,
    origin: 'manual' | 'trade' = 'manual',
    notes?: string
  ): Promise<WatchlistItem> {
    const db = getDb()
    const now = new Date().toISOString()

    // Upsert asset
    const assetId = this.upsertAsset(db, symbol, market, name, assetType)

    // Check if already in watchlist
    const existing = db.prepare('SELECT * FROM watchlist_items WHERE asset_id = ?').get(assetId) as WatchlistItem | undefined
    if (existing) {
      // Re-activate if archived
      if (!existing.is_visible) {
        db.prepare(`
          UPDATE watchlist_items
          SET is_visible = 1, origin = ?, notes = ?, updated_at = ?
          WHERE id = ?
        `).run(origin, notes || null, now, existing.id)
        return { ...existing, is_visible: true, origin, notes: notes || null, updated_at: now }
      }
      return existing
    }

    const id = uuid()
    db.prepare(`
      INSERT INTO watchlist_items (id, asset_id, origin, is_visible, sort_order, notes, created_at, updated_at, last_tracked_at)
      VALUES (?, ?, ?, 1, 0, ?, ?, ?, ?)
    `).run(id, assetId, origin, notes || null, now, now, now)

    return {
      id, asset_id: assetId, origin, is_visible: true, sort_order: 0,
      notes: notes || null, created_at: now, updated_at: now, last_tracked_at: now,
    }
  }

  /**
   * Remove an asset from the watchlist.
   * Only allowed if positions.quantity == 0.
   * If has holdings, archive (is_visible=0) instead of deleting.
   */
  remove(assetId: string): { removed: boolean; archived: boolean; reason?: string } {
    const db = getDb()

    const pos = db.prepare(`
      SELECT quantity FROM positions WHERE asset_id = ? AND quantity > 0 LIMIT 1
    `).get(assetId) as { quantity: number } | undefined

    if (pos && pos.quantity > 0) {
      // Has holdings — archive instead of remove
      db.prepare(`
        UPDATE watchlist_items SET is_visible = 0, updated_at = ? WHERE asset_id = ?
      `).run(new Date().toISOString(), assetId)
      return { removed: false, archived: true, reason: '该标的仍有持仓，已归档到未关注列表' }
    }

    db.prepare('DELETE FROM watchlist_items WHERE asset_id = ?').run(assetId)
    return { removed: true, archived: false }
  }

  /**
   * List all visible watchlist items with position status and latest quotes.
   */
  list(assetType?: string): WatchlistItemWithStatus[] {
    const db = getDb()

    let sql = `
      SELECT
        w.id, w.asset_id, w.origin, w.is_visible, w.notes, w.created_at, w.last_tracked_at,
        a.symbol, a.market, a.name, a.asset_type,
        COALESCE(p.quantity, 0) AS quantity,
        q.id AS q_id, q.price AS q_price, q.change_pct, q.volume, q.turnover, q.quote_time, q.source
      FROM watchlist_items w
      JOIN assets a ON w.asset_id = a.id
      LEFT JOIN positions p ON p.asset_id = w.asset_id AND p.quantity > 0
      LEFT JOIN market_quotes q ON q.id = (
        SELECT mq.id FROM market_quotes mq
        WHERE mq.asset_id = w.asset_id
        ORDER BY mq.quote_time DESC LIMIT 1
      )
      WHERE w.is_visible = 1
    `
    const params: (string | number)[] = []

    if (assetType && assetType !== 'all') {
      sql += ` AND a.asset_type = ?`
      params.push(assetType)
    }

    sql += ` ORDER BY w.sort_order ASC, w.created_at DESC`

    const rows = db.prepare(sql).all(...params) as any[]

    return rows.map((row) => {
      const quote: MarketQuote | null = row.q_id
        ? {
            id: row.q_id,
            asset_id: row.asset_id,
            symbol: row.symbol,
            market: row.market,
            price: row.q_price,
            change_pct: row.change_pct,
            volume: row.volume,
            turnover: row.turnover,
            quote_time: row.quote_time,
            source: row.source,
          }
        : null

      const quality: DataQualityStatus | null = quote
        ? this.buildQuality(quote)
        : null

      return {
        id: row.id,
        asset_id: row.asset_id,
        symbol: row.symbol,
        market: row.market,
        name: row.name,
        asset_type: row.asset_type,
        origin: row.origin,
        is_visible: Boolean(row.is_visible),
        has_position: (row.quantity ?? 0) > 0,
        quantity: row.quantity ?? 0,
        notes: row.notes,
        quote,
        quote_quality: quality,
        last_tracked_at: row.last_tracked_at,
        created_at: row.created_at,
      }
    })
  }

  /**
   * Get a single watchlist item with full detail.
   */
  getDetail(assetId: string): WatchlistItemWithStatus | null {
    const db = getDb()
    const row = db.prepare(`
      SELECT
        w.id, w.asset_id, w.origin, w.is_visible, w.notes, w.created_at, w.last_tracked_at,
        a.symbol, a.market, a.name, a.asset_type,
        COALESCE(p.quantity, 0) AS quantity,
        q.id AS q_id, q.price AS q_price, q.change_pct, q.volume, q.turnover, q.quote_time, q.source
      FROM watchlist_items w
      JOIN assets a ON w.asset_id = a.id
      LEFT JOIN positions p ON p.asset_id = w.asset_id AND p.quantity > 0
      LEFT JOIN market_quotes q ON q.id = (
        SELECT mq.id FROM market_quotes mq
        WHERE mq.asset_id = w.asset_id
        ORDER BY mq.quote_time DESC LIMIT 1
      )
      WHERE w.asset_id = ? AND w.is_visible = 1
    `).get(assetId) as any | undefined

    if (!row) return null

    const quote: MarketQuote | null = row.q_id
      ? {
          id: row.q_id,
          asset_id: row.asset_id,
          symbol: row.symbol,
          market: row.market,
          price: row.q_price,
          change_pct: row.change_pct,
          volume: row.volume,
          turnover: row.turnover,
          quote_time: row.quote_time,
          source: row.source,
        }
      : null

    return {
      id: row.id,
      asset_id: row.asset_id,
      symbol: row.symbol,
      market: row.market,
      name: row.name,
      asset_type: row.asset_type,
      origin: row.origin,
      is_visible: Boolean(row.is_visible),
      has_position: (row.quantity ?? 0) > 0,
      quantity: row.quantity ?? 0,
      notes: row.notes,
      quote,
      quote_quality: quote ? this.buildQuality(quote) : null,
      last_tracked_at: row.last_tracked_at,
      created_at: row.created_at,
    }
  }

  /**
   * Update last_tracked_at timestamp.
   */
  touch(assetId: string): void {
    const db = getDb()
    db.prepare(`
      UPDATE watchlist_items SET last_tracked_at = ? WHERE asset_id = ?
    `).run(new Date().toISOString(), assetId)
  }

  /**
   * Get all asset IDs that should be synced (watchlist visible + positions with holdings).
   */
  getSyncAssetIds(): string[] {
    const db = getDb()
    const rows = db.prepare(`
      SELECT DISTINCT asset_id FROM (
        SELECT asset_id FROM watchlist_items WHERE is_visible = 1
        UNION
        SELECT asset_id FROM positions WHERE quantity > 0
      )
    `).all() as { asset_id: string }[]
    return rows.map((r) => r.asset_id)
  }

  // ---- Private helpers ----

  private upsertAsset(
    db: ReturnType<typeof getDb>,
    symbol: string,
    market: string,
    name?: string,
    assetType?: string
  ): string {
    // Normalize market for funds
    const normalizedMarket = this.normalizeFundMarket(market, assetType, symbol)

    const existing = db.prepare(`
      SELECT id FROM assets WHERE symbol = ? AND market = ?
    `).get(symbol, normalizedMarket) as { id: string } | undefined

    if (existing) return existing.id

    const id = uuid()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO assets (id, symbol, market, name, asset_type, currency, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'CNY', ?, ?)
    `).run(id, symbol, normalizedMarket, name || symbol, assetType || 'stock', now, now)

    return id
  }

  /**
   * Normalize market for funds. Off-exchange funds should use 'OF' market.
   */
  private normalizeFundMarket(market: string, assetType?: string, symbol?: string): string {
    if (assetType === 'fund') return 'OF'
    const m = market.toUpperCase()
    if (m === 'OF' || m === 'FUND') return 'OF'
    // Auto-detect fund by symbol pattern (6-digit not matching stock/ETF prefixes)
    if (symbol && /^\d{6}$/.test(symbol) && !/^(60|68|00|30|51|56|15|16|18|88)/.test(symbol)) {
      return 'OF'
    }
    return market
  }

  private buildQuality(quote: MarketQuote): DataQualityStatus {
    const quoteTime = quote.quote_time ? new Date(quote.quote_time).getTime() : 0
    const nowMs = Date.now()
    const stalenessMs = quoteTime > 0 ? nowMs - quoteTime : Infinity

    let confidence: 'high' | 'medium' | 'low'
    if (stalenessMs < 60_000) confidence = 'high'
    else if (stalenessMs < 300_000) confidence = 'medium'
    else confidence = 'low'

    return {
      source: quote.source || 'unknown',
      source_time: quote.quote_time,
      staleness_ms: stalenessMs,
      confidence,
      error_message: null,
    }
  }
}

// Singleton
let service: WatchlistService | null = null
export function getWatchlistService(): WatchlistService {
  if (!service) service = new WatchlistService()
  return service
}
