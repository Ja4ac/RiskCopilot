// ============================================================
// FundTradeService — fund purchases, NAV sync, fund performance
// ============================================================

import { v4 as uuid } from 'uuid'
import { getDb } from '../../db'
import type { Trade } from '../../../shared/types/database'
import * as AssetRepo from '../../db/repositories/asset.repository'
import { fetchFundNavFromProxy, fetchFundNavHistoryFromProxy } from '../data-proxy'

export class FundTradeService {
  /**
   * Chinese public holidays 2026 (hardcoded for accuracy).
   * Values are dates in 'YYYY-MM-DD' format that are NON-TRADING days.
   */
  static CHINA_HOLIDAYS_2026 = new Set([
    // New Year
    '2026-01-01', '2026-01-02',
    // Spring Festival
    '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-23',
    // Qingming
    '2026-04-04', '2026-04-05', '2026-04-06',
    // Labor Day
    '2026-05-01', '2026-05-04', '2026-05-05',
    // Dragon Boat
    '2026-06-19', '2026-06-22',
    // Mid-Autumn + National Day
    '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08',
  ])

  private recalculatePosition: (assetId: string, accountId: string) => void
  private recordDailyPortfolioValue: (date?: string) => void

  constructor(
    recalculatePosition: (assetId: string, accountId: string) => void,
    recordDailyPortfolioValue: (date?: string) => void
  ) {
    this.recalculatePosition = recalculatePosition
    this.recordDailyPortfolioValue = recordDailyPortfolioValue
  }

  isTradingDay(dateStr: string): boolean {
    const d = new Date(dateStr)
    const dow = d.getDay()
    if (dow === 0 || dow === 6) return false
    return !FundTradeService.CHINA_HOLIDAYS_2026.has(dateStr)
  }

  /**
   * Compute fund trade date and confirmation date per Chinese mutual fund rules:
   *   - Before 15:00 on trading day → T-day = purchase day, confirmation = T+1
   *   - After 15:00 on trading day → T-day = next trading day, confirmation = T+1 (which is T+2 from purchase)
   *   - Non-trading day → T-day = next trading day, confirmation = T+1
   *   - Weekends AND public holidays are skipped
   *
   * Returns both the effective trade date (T-day, used for NAV lookup) and confirmation date.
   */
  computeFundConfirmationDate(purchaseTime: string): { tradeDate: string; confirmationDate: string } {
    const date = new Date(purchaseTime)
    const hour = date.getHours()

    const purchaseDateStr = date.toISOString().slice(0, 10)
    const isTrading = this.isTradingDay(purchaseDateStr)

    let isBeforeCutoff = hour < 15
    if (!isTrading) {
      isBeforeCutoff = true // Non-trading day purchases are treated as next trading day before 15:00
    }

    let current = new Date(date)

    // If starting on a non-trading day, jump to the next trading day first
    if (!isTrading) {
      while (!this.isTradingDay(current.toISOString().slice(0, 10))) {
        current.setDate(current.getDate() + 1)
      }
    } else if (!isBeforeCutoff) {
      // After 15:00 on trading day → T-day is next trading day
      current.setDate(current.getDate() + 1)
      while (!this.isTradingDay(current.toISOString().slice(0, 10))) {
        current.setDate(current.getDate() + 1)
      }
    }

    const tradeDate = current.toISOString().slice(0, 10)

    let daysToAdd = 1
    while (daysToAdd > 0) {
      current.setDate(current.getDate() + 1)
      if (this.isTradingDay(current.toISOString().slice(0, 10))) {
        daysToAdd--
      }
    }

    const confirmationDate = current.toISOString().slice(0, 10)

    return { tradeDate, confirmationDate }
  }

  /**
   * Add a fund purchase (snapshot style) and recalculate the position.
   *
   * Logic:
   *   1. Compute confirmation date per fund trading rules (T+1/T+2, skip weekends).
   *   2. Fetch NAV on confirmation date via AKShare proxy.
   *   3. shares = amount / NAV
   *   4. Generate a virtual buy trade and recalculate position.
   */
  async addFundPurchase(payload: { symbol: string; name?: string; amount: number; purchase_time: string; account_id?: string; side?: 'buy' | 'sell' }): Promise<Trade> {
    const { symbol, name, amount, purchase_time, account_id, side = 'buy' } = payload
    console.log(`[addFundPurchase] Start: symbol=${symbol}, amount=${amount}, purchase_time=${purchase_time}`)

    if (!symbol || amount <= 0) {
      throw new Error('基金代码和买入金额必须有效')
    }

    // 1. Compute trade date (T-day, used for NAV lookup) and confirmation date
    const { tradeDate, confirmationDate } = this.computeFundConfirmationDate(purchase_time)
    console.log(`[addFundPurchase] Trade date (T-day): ${tradeDate}, Confirmation date: ${confirmationDate}`)

    // 2. Fetch NAV on TRADE date (T-day), NOT confirmation date.
    // Fund shares are calculated using the NAV of the trade day (T-day).
    let nav: number
    let navDate: string
    let navDataResult: { nav: number; nav_date: string; name: string | null } | null = null
    try {
      console.log(`[addFundPurchase] Fetching NAV for ${symbol} on trade date ${tradeDate}...`)
      navDataResult = await fetchFundNavFromProxy(symbol, tradeDate)
      nav = navDataResult.nav
      navDate = navDataResult.nav_date
      console.log(`[addFundPurchase] NAV fetched: ${nav} on ${navDate}`)
    } catch (e: any) {
      console.warn(`[addFundPurchase] NAV fetch failed for trade date: ${e.message}`)
      // Fallback: try purchase date directly
      try {
        const purchaseDate = purchase_time.slice(0, 10)
        console.log(`[addFundPurchase] Fallback: fetching NAV for ${symbol} on purchase date ${purchaseDate}...`)
        navDataResult = await fetchFundNavFromProxy(symbol, purchaseDate)
        nav = navDataResult.nav
        navDate = navDataResult.nav_date
        console.log(`[addFundPurchase] Fallback NAV fetched: ${nav} on ${navDate}`)
      } catch (e2: any) {
        console.error(`[addFundPurchase] Fallback NAV fetch also failed: ${e2.message}`)
        // Determine if it's a proxy connectivity issue
        const isProxyError = e.message?.includes('ECONNREFUSED') || e.message?.includes('Proxy HTTP')
        if (isProxyError) {
          throw new Error(
            `无法连接 Python AKShare 数据代理，无法查询基金 ${symbol} 的净值。\n\n` +
            `请检查：\n` +
            `1. 是否已安装依赖：cd python-proxy && pip install -r requirements.txt\n` +
            `2. 应用启动时代理是否正常启动（查看控制台是否有 "[DataProxy] Health check passed"）\n` +
            `3. 如代理启动失败，可手动运行：py python-proxy/main.py\n\n` +
            `技术错误: ${e.message}`
          )
        }
        throw new Error(
          `无法获取基金 ${symbol} 的净值数据。\n\n` +
          `可能原因：\n` +
          `1. 基金代码不正确（请确认是准确的 6 位基金代码）\n` +
          `2. AKShare 数据源暂无该记录（某些 C 类份额或新基金可能未收录）\n` +
          `3. 网络连接问题\n\n` +
          `建议：\n` +
          `• 如果是 C 类份额（如 xxxC），尝试查找对应的 A 类代码（如 xxxA）\n` +
          `• 或先通过「添加交易」按钮手动录入（代码:${symbol}, 类型:基金, 方向:买入, 数量=金额/净值, 价格=净值）\n\n` +
          `技术错误: ${e.message}`
        )
      }
    }

    // 3. Calculate shares
    const shares = amount / nav
    console.log(`[addFundPurchase] Shares: ${shares} (amount=${amount} / nav=${nav})`)

    // 4. Upsert asset (fund market = OF)
    // Auto-fill name: user input > proxy response > stock_listings > code
    let fundName = name || navDataResult?.name || ''
    if (!fundName) {
      // stock_listings fund entries use market='SH' but fund purchases use 'OF'
      const fromListings = getDb().prepare(`SELECT name FROM stock_listings WHERE symbol = ? AND is_active = 1 AND asset_type = 'fund' LIMIT 1`)
        .get(symbol) as { name: string } | undefined
      fundName = fromListings?.name || symbol
    }
    const asset = AssetRepo.upsert({
      symbol,
      market: 'OF',
      name: fundName,
      asset_type: 'fund',
    })
    console.log(`[addFundPurchase] Asset upserted: id=${asset.id}, symbol=${asset.symbol}`)

    // 5. Create virtual trade
    const trade: Trade = {
      id: uuid(),
      asset_id: asset.id,
      account_id: account_id || 'default',
      side,
      quantity: Math.round(shares * 10000) / 10000, // 4 decimal places for fund shares
      price: nav,
      fee: 0,
      tax: 0,
      trade_time: `${confirmationDate}T00:00:00.000Z`, // Use confirmation date (T+1) as trade time
      source: 'fund_purchase',
      status: 'active',
      created_at: new Date().toISOString(),
    }

    const db = getDb()
    db.prepare(`
      INSERT INTO trades (id, asset_id, account_id, side, quantity, price, fee, tax, trade_time, source, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      trade.id, trade.asset_id, trade.account_id, trade.side,
      trade.quantity, trade.price, trade.fee, trade.tax,
      trade.trade_time, trade.source, trade.status, trade.created_at
    )
    console.log(`[addFundPurchase] Trade inserted: id=${trade.id}`)

    // 6. Recalculate position
    this.recalculatePosition(asset.id, trade.account_id)
    console.log(`[addFundPurchase] Position recalculated for asset ${asset.id}`)

    // Record daily portfolio snapshot
    this.recordDailyPortfolioValue()

    return trade
  }

  /**
   * Get yesterday's NAV for a fund from fund_navs table.
   * Falls back to fetching from proxy if not available locally.
   */
  /** Get the most recent NAV (the quote price equivalent) */
  getLatestNav(symbol: string, market: string): number {
    const db = getDb()
    const row = db.prepare(`SELECT nav FROM fund_navs WHERE symbol=? AND market=? ORDER BY nav_date DESC LIMIT 1`).get(symbol, market) as { nav: number } | undefined
    return row?.nav ?? 0
  }

  /** Get the NAV immediately before the most recent one (yesterday's equivalent) */
  getPrevNav(symbol: string, market: string): number {
    const db = getDb()
    const latestDate = db.prepare(`SELECT MAX(nav_date) as md FROM fund_navs WHERE symbol=? AND market=?`).get(symbol, market) as { md: string } | undefined
    if (!latestDate?.md) return 0
    const prev = db.prepare(`SELECT nav FROM fund_navs WHERE symbol=? AND market=? AND nav_date<? ORDER BY nav_date DESC LIMIT 1`)
      .get(symbol, market, latestDate.md) as { nav: number } | undefined
    return prev?.nav ?? 0
  }

  /** Get the NAV before the previous one (day-before-yesterday's equivalent) */
  getDayBeforeNav(symbol: string, market: string): number {
    const db = getDb()
    const latestDate = db.prepare(`SELECT MAX(nav_date) as md FROM fund_navs WHERE symbol=? AND market=?`).get(symbol, market) as { md: string } | undefined
    if (!latestDate?.md) return 0
    const prevDate = db.prepare(`SELECT nav_date FROM fund_navs WHERE symbol=? AND market=? AND nav_date<? ORDER BY nav_date DESC LIMIT 1`)
      .get(symbol, market, latestDate.md) as { nav_date: string } | undefined
    if (!prevDate?.nav_date) return 0
    const prev2 = db.prepare(`SELECT nav FROM fund_navs WHERE symbol=? AND market=? AND nav_date<? ORDER BY nav_date DESC LIMIT 1`)
      .get(symbol, market, prevDate.nav_date) as { nav: number } | undefined
    return prev2?.nav ?? 0
  }

  /** (deprecated) Use getPrevNav for yesterday NAV */
  getYesterdayNav(symbol: string, market: string): number {
    return this.getPrevNav(symbol, market)
  }

  /**
   * Sync fund NAV history from proxy to local fund_navs table.
   * Called periodically or when viewing fund details.
   */
  async syncFundNavHistory(symbol: string, market: string, fullHistory = false): Promise<void> {
    try {
      let startDate: string | undefined
      if (!fullHistory) {
        const d = new Date()
        d.setFullYear(d.getFullYear() - 1)
        startDate = d.toISOString().slice(0, 10)
      }
      const result = await fetchFundNavHistoryFromProxy(symbol, startDate)

      const db = getDb()
      const insert = db.prepare(`
        INSERT OR IGNORE INTO fund_navs (symbol, market, nav, accumulated_nav, daily_return_pct, source, nav_date)
        VALUES (?, ?, ?, NULL, NULL, 'akshare', ?)
      `)

      for (const item of result.history) {
        insert.run(symbol, market, item.nav, item.nav_date)
      }

      console.log(`[syncFundNavHistory] Synced ${result.count} NAV records for ${symbol}${fullHistory ? ' (full history)' : ''}`)
    } catch (e: any) {
      const errorMsg = e?.message || String(e) || 'Unknown error'
      console.warn(`[syncFundNavHistory] Failed for ${symbol}: ${errorMsg}`)
    }
  }

  /**
   * Get fund performance history for charting.
   * Returns NAV history with cumulative return calculated.
   */
  async getFundPerformance(symbol: string, market: string, range: '1m' | '3m' | '6m' | '1y' | 'all' = 'all'): Promise<{
    dates: string[]
    navs: number[]
    cumulativeReturns: number[]
  }> {
    try {
      // Ensure history is synced (fetch full history for 'all' range)
      try {
        await this.syncFundNavHistory(symbol, market, range === 'all')
      } catch (syncError: any) {
        console.warn(`[getFundPerformance] Sync failed for ${symbol}, using cached data:`, syncError?.message || syncError)
      }

      const db = getDb()

      // Determine date range
      const endDate = new Date().toISOString().slice(0, 10)
      let startDate: string
      const now = new Date()
      switch (range) {
        case '1m':
          startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()).toISOString().slice(0, 10)
          break
        case '3m':
          startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()).toISOString().slice(0, 10)
          break
        case '6m':
          startDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()).toISOString().slice(0, 10)
          break
        case '1y':
          startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().slice(0, 10)
          break
        default:
          startDate = '2000-01-01'
      }

      const rows = db.prepare(`
        SELECT nav_date, nav FROM fund_navs
        WHERE symbol = ? AND market = ? AND nav_date >= ? AND nav_date <= ?
        ORDER BY nav_date ASC
      `).all(symbol, market, startDate, endDate) as { nav_date: string; nav: number }[]

      if (rows.length === 0) {
        return { dates: [], navs: [], cumulativeReturns: [] }
      }

      const firstNav = rows[0].nav
      const dates = rows.map((r) => r.nav_date)
      const navs = rows.map((r) => r.nav)
      const cumulativeReturns = rows.map((r) =>
        firstNav > 0 ? Math.round(((r.nav - firstNav) / firstNav) * 10000) / 100 : 0
      )

      return { dates, navs, cumulativeReturns }
    } catch (error: any) {
      console.error(`[getFundPerformance] Error for ${symbol}:`, error)
      throw new Error(error?.message || String(error) || `Failed to get fund performance for ${symbol}`)
    }
  }
}
