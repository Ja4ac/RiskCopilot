import { getDb } from '../db/index'
import { EastMoneyProvider } from './market-providers/eastmoney-provider'

interface ListingRecord {
  symbol: string
  market: string
  name: string
  asset_type: 'stock' | 'etf' | 'fund'
  industry: string | null
  last_quote_price?: number
  last_quote_change_pct?: number
  change_1w_pct?: number
  change_1m_pct?: number
  change_3m_pct?: number
  change_6m_pct?: number
  change_1y_pct?: number
}

/**
 * StockListingService — fetches full market listings from East Money
 * and caches them in the stock_listings SQLite table.
 */
export class StockListingService {
  private provider = new EastMoneyProvider()

  /**
   * Check if listings table has data.
   */
  hasListings(): boolean {
    const db = getDb()
    const row = db.prepare('SELECT COUNT(*) as c FROM stock_listings WHERE is_active = 1').get() as { c: number }
    return row.c > 0
  }

  /**
   * Get total count of listings.
   */
  getCount(): number {
    const db = getDb()
    const row = db.prepare('SELECT COUNT(*) as c FROM stock_listings WHERE is_active = 1').get() as { c: number }
    return row.c
  }

  /**
   * Search listings by symbol or name (paged).
   * If query looks like a 6-digit code, prioritize exact symbol match.
   */
  searchListings(query: string, assetType?: string, limit = 50, offset = 0): ListingRecord[] {
    const db = getDb()
    const trimmed = query.trim()
    const isExactCode = /^\d{6}$/.test(trimmed)

    let sql: string
    const params: (string | number)[] = []

    const cols = 'symbol, market, name, asset_type, industry, last_quote_price, last_quote_change_pct, last_quote_time, change_1w_pct, change_1m_pct, change_3m_pct, change_6m_pct, change_1y_pct'
    if (isExactCode) {
      // Exact symbol match first, then name contains
      sql = `
        SELECT ${cols}
        FROM stock_listings
        WHERE is_active = 1 AND symbol = ?
      `
      params.push(trimmed)
    } else {
      const q = `%${trimmed}%`
      sql = `
        SELECT ${cols}
        FROM stock_listings
        WHERE is_active = 1 AND (symbol LIKE ? OR name LIKE ?)
      `
      params.push(q, q)
    }

    if (assetType && assetType !== 'all') {
      sql += ' AND asset_type = ?'
      params.push(assetType)
    }

    sql += ' ORDER BY symbol ASC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    return db.prepare(sql).all(...params) as ListingRecord[]
  }

  /**
   * Get listings by asset type (paged). Pass assetType='all' or omit to get all types.
   */
  getListingsByType(assetType?: string, limit = 50, offset = 0): ListingRecord[] {
    const db = getDb()
    const cols = 'symbol, market, name, asset_type, industry, last_quote_price, last_quote_change_pct, last_quote_time, change_1w_pct, change_1m_pct, change_3m_pct, change_6m_pct, change_1y_pct'
    if (assetType && assetType !== 'all') {
      return db.prepare(`
        SELECT ${cols}
        FROM stock_listings
        WHERE is_active = 1 AND asset_type = ?
        ORDER BY symbol ASC
        LIMIT ? OFFSET ?
      `).all(assetType, limit, offset) as ListingRecord[]
    }
    return db.prepare(`
      SELECT ${cols}
      FROM stock_listings
      WHERE is_active = 1
      ORDER BY symbol ASC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as ListingRecord[]
  }

  /**
   * Fetch and cache full market listings from East Money.
   * This should be called on first launch or when user triggers refresh.
   * Uses a single transaction so failure never wipes existing data.
   */
  async refreshListings(): Promise<{ stocks: number; funds: number }> {
    const db = getDb()

    // Fetch A-shares + ETFs first (fail fast if this breaks)
    let aStocks: Array<{
      symbol: string; market: string; name: string
      asset_type: 'stock' | 'etf'; industry: string | null
    }> = []
    try {
      aStocks = await this.provider.fetchAStockListings()
    } catch (e: any) {
      console.error('[StockListingService] A-share fetch failed:', e.message)
      throw new Error(`A股列表获取失败: ${e.message}`)
    }

    // Fetch funds (non-critical — keep going if this fails)
    let funds: Array<{
      symbol: string; market: string; name: string
      asset_type: 'fund'; industry: string | null
    }> = []
    try {
      funds = await this.provider.fetchFundListings()
    } catch (e: any) {
      console.error('[StockListingService] Fund fetch failed:', e.message)
    }

    const insert = db.prepare(`
      INSERT OR REPLACE INTO stock_listings
      (symbol, market, name, asset_type, industry, is_active, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, datetime('now','localtime'))
    `)

    // Insert funds (deduplicate by symbol)
    const fundMap = new Map<string, ListingRecord>()
    for (const f of funds) {
      if (!fundMap.has(f.symbol)) {
        fundMap.set(f.symbol, f)
      }
    }

    // Run everything inside one transaction so failure is atomic
    const refreshTx = db.transaction(() => {
      db.prepare('UPDATE stock_listings SET is_active = 0').run()

      for (const s of aStocks) {
        insert.run(s.symbol, s.market, s.name, s.asset_type, s.industry)
      }

      for (const f of fundMap.values()) {
        insert.run(f.symbol, f.market, f.name, f.asset_type, f.industry)
      }

      db.prepare(`
        DELETE FROM stock_listings
        WHERE is_active = 0 AND updated_at < datetime('now','localtime','-90 days')
      `).run()
    })

    refreshTx()

    return { stocks: aStocks.length, funds: fundMap.size }
  }

  /**
   * Update last quote for a listing (called after fetching real-time quotes).
   */
  updateQuote(symbol: string, market: string, price: number, changePct: number): void {
    const db = getDb()
    db.prepare(`
      UPDATE stock_listings
      SET last_quote_price = ?, last_quote_change_pct = ?, last_quote_time = datetime('now','localtime')
      WHERE symbol = ? AND market = ?
    `).run(price, changePct, symbol, market)
  }
}

// Singleton
let service: StockListingService | null = null
export function getStockListingService(): StockListingService {
  if (!service) service = new StockListingService()
  return service
}
