// ============================================================
// PortfolioService — positions, trades, summary, CSV import/export
// ============================================================

import { v4 as uuid } from 'uuid'
import { getDb } from '../db'
import type {
  PositionWithAsset,
  PortfolioSummary,
  Trade,
  Asset,
  Market,
  MarketQuote,
  ImportPreviewResult,
  ImportCommitResult,
  ImportRowError
} from '../../shared/types/database'
import type { IpcAddTradePayload, IpcImportCsvResult } from '../../shared/types/ipc'
import * as AssetRepo from '../db/repositories/asset.repository'
import * as fs from 'fs'
import * as path from 'path'
import { guessMarket } from '../utils/market-detection'
import { parseCSVLine, detectFieldMapping, applyFieldMapping, validateImportRow } from '../utils/import-utils'
import { fetchFundNavFromProxy, fetchFundNavHistoryFromProxy } from './data-proxy'

export class PortfolioService {
  /**
   * Get all positions joined with asset info and latest quote
   */
  getPositionsWithDetails(): PositionWithAsset[] {
    const db = getDb()

    // Funds (market='OF'): prefer python-proxy-nav source for accuracy
    const fundRows = db.prepare(`
      SELECT
        p.id, p.asset_id, p.account_id, p.quantity, p.avg_cost, p.cost_amount,
        p.market_value, p.unrealized_pnl, p.updated_at,
        a.id AS a_id, a.symbol, a.market, a.name, a.asset_type, a.currency,
        a.industry, a.style, a.exchange, a.created_at AS a_created_at, a.updated_at AS a_updated_at,
        q.id AS q_id, q.price AS q_price, q.change_pct, q.volume, q.turnover,
        q.quote_time, q.source
      FROM positions p
      JOIN assets a ON p.asset_id = a.id
      LEFT JOIN market_quotes q ON q.id = (
        SELECT mq.id FROM market_quotes mq
        WHERE mq.asset_id = p.asset_id
        ORDER BY (mq.source = 'python-proxy-nav') DESC, mq.quote_time DESC
        LIMIT 1
      )
      WHERE p.quantity != 0 AND a.market = 'OF'
      ORDER BY a.symbol ASC
    `).all() as any[]

    // Non-funds: just use the latest quote by time
    const nonFundRows = db.prepare(`
      SELECT
        p.id, p.asset_id, p.account_id, p.quantity, p.avg_cost, p.cost_amount,
        p.market_value, p.unrealized_pnl, p.updated_at,
        a.id AS a_id, a.symbol, a.market, a.name, a.asset_type, a.currency,
        a.industry, a.style, a.exchange, a.created_at AS a_created_at, a.updated_at AS a_updated_at,
        q.id AS q_id, q.price AS q_price, q.change_pct, q.volume, q.turnover,
        q.quote_time, q.source
      FROM positions p
      JOIN assets a ON p.asset_id = a.id
      LEFT JOIN market_quotes q ON q.id = (
        SELECT mq.id FROM market_quotes mq
        WHERE mq.asset_id = p.asset_id
        ORDER BY mq.quote_time DESC
        LIMIT 1
      )
      WHERE p.quantity != 0 AND a.market != 'OF'
      ORDER BY a.symbol ASC
    `).all() as any[]

    const rows = [...fundRows, ...nonFundRows]

    const positions = rows.map((row) => this.buildPositionWithAsset(row))

    // Recalculate market value from latest quote for ALL positions.
    // This ensures accuracy even when market-sync failed to update positions table.
    for (const pos of positions) {
      const quotePrice = pos.quote?.price ?? 0
      if (quotePrice > 0 && pos.quantity > 0) {
        pos.market_value = Math.round(pos.quantity * quotePrice * 100) / 100
        pos.unrealized_pnl = Math.round((pos.market_value - pos.cost_amount) * 100) / 100
      }
    }

    const totalValue = positions.reduce((sum, p) => sum + (p.market_value || 0), 0)

    // Compute previous day's total value for daily P&L
    // We approximate daily P&L from quote change_pct
    for (const pos of positions) {
      pos.weight_pct = totalValue > 0 ? Math.round((pos.market_value / totalValue) * 10000) / 100 : 0
      
      // Derive current price from quote first (must be > 0), then fallback to market_value/quantity
      const rawQuotePrice = pos.quote?.price ?? 0
      const currentPrice = rawQuotePrice > 0 ? rawQuotePrice : (pos.market_value > 0 && pos.quantity > 0 ? pos.market_value / pos.quantity : pos.avg_cost)
      
      // Calculate yesterday's P&L
      if (pos.asset?.asset_type === 'fund') {
        // For funds: get yesterday's NAV from fund_navs table
        const yesterdayNav = this.getYesterdayNav(pos.asset.symbol, pos.asset.market)
        if (yesterdayNav > 0 && currentPrice > 0) {
          pos.yesterday_pnl = Math.round(pos.quantity * (currentPrice - yesterdayNav) * 100) / 100
        } else if (pos.quote && pos.quote.change_pct !== null) {
          // Fallback: derive from change_pct if fund_navs not yet synced
          const yesterdayPrice = currentPrice / (1 + pos.quote.change_pct / 100)
          pos.yesterday_pnl = Math.round(pos.quantity * (currentPrice - yesterdayPrice) * 100) / 100
        } else {
          pos.yesterday_pnl = 0
        }
      } else {
        // For stocks: derive from change_pct
        if (pos.quote && pos.quote.change_pct !== null) {
          const yesterdayPrice = currentPrice / (1 + pos.quote.change_pct / 100)
          pos.yesterday_pnl = Math.round(pos.quantity * (currentPrice - yesterdayPrice) * 100) / 100
        } else {
          pos.yesterday_pnl = 0
        }
      }
      
      if (pos.quote && pos.quote.change_pct !== null) {
        pos.daily_pnl = Math.round(pos.market_value * (pos.quote.change_pct / 100) * 100) / 100
      } else {
        pos.daily_pnl = 0
      }
      
      pos.total_return_pct = pos.avg_cost > 0
        ? Math.round(((currentPrice - pos.avg_cost) / pos.avg_cost) * 10000) / 100
        : 0
      pos.risk_tag = this.computeRiskTag(pos.total_return_pct, pos.asset?.asset_type ?? 'stock')
      pos.news_sentiment = this.getLatestNewsSentiment(pos.asset_id)

      if (pos.asset?.asset_type === 'fund') {
        // Fund-specific logging is omitted to reduce log spam
      }
    }

    return positions
  }

  /**
   * Get portfolio summary
   */
  getSummary(): PortfolioSummary {
    const positions = this.getPositionsWithDetails()
    const totalMarketValue = positions.reduce((s, p) => s + p.market_value, 0)
    const totalCost = positions.reduce((s, p) => s + p.cost_amount, 0)
    const todayPnl = positions.reduce((s, p) => s + p.daily_pnl, 0)
    const yesterdayPnl = positions.reduce((s, p) => s + p.yesterday_pnl, 0)
    const cumulativePnl = totalMarketValue - totalCost
    const todayPnlPct = totalCost > 0 ? Math.round((todayPnl / (totalMarketValue - todayPnl || 1)) * 10000) / 100 : 0
    const yesterdayPnlPct = totalCost > 0 ? Math.round((yesterdayPnl / (totalMarketValue - yesterdayPnl || 1)) * 10000) / 100 : 0
    const cumulativeReturnPct = totalCost > 0 ? Math.round((cumulativePnl / totalCost) * 10000) / 100 : 0

    // Simple risk score from positions (will be overridden by RiskService)
    const riskScore = this.computeSimpleRiskScore(positions)

    return {
      total_assets: positions.length,
      total_market_value: Math.round(totalMarketValue * 100) / 100,
      total_cost: Math.round(totalCost * 100) / 100,
      today_pnl: Math.round(todayPnl * 100) / 100,
      today_pnl_pct: todayPnlPct,
      yesterday_pnl: Math.round(yesterdayPnl * 100) / 100,
      yesterday_pnl_pct: yesterdayPnlPct,
      cumulative_pnl: Math.round(cumulativePnl * 100) / 100,
      cumulative_return_pct: cumulativeReturnPct,
      risk_score: riskScore.score,
      risk_level: riskScore.level,
      position_count: positions.filter((p) => p.quantity > 0).length
    }
  }

  /**
   * Record daily portfolio value snapshot.
   * Should be called after any trade modification.
   */
  recordDailyPortfolioValue(): void {
    const db = getDb()
    const positions = this.getPositionsWithDetails()
    const totalMarketValue = positions.reduce((s, p) => s + p.market_value, 0)
    const totalCost = positions.reduce((s, p) => s + p.cost_amount, 0)
    const totalPnl = totalMarketValue - totalCost
    const date = new Date().toISOString().slice(0, 10)

    db.prepare(`
      INSERT OR REPLACE INTO portfolio_daily_value (id, date, total_market_value, total_cost, total_pnl)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      `pv_${date}`,
      date,
      Math.round(totalMarketValue * 100) / 100,
      Math.round(totalCost * 100) / 100,
      Math.round(totalPnl * 100) / 100
    )
  }

  /**
   * Get portfolio performance history for charting.
   */
  getPortfolioPerformance(range: '1m' | '3m' | '6m' | '1y' | 'all' = 'all'): {
    dates: string[]
    values: number[]
    cumulativeReturns: number[]
  } {
    const db = getDb()

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
        // For 'all', find the earliest trade date
        const earliest = db.prepare(`SELECT MIN(trade_time) as min_time FROM trades WHERE status = 'active'`).get() as { min_time: string } | undefined
        startDate = earliest?.min_time ? earliest.min_time.slice(0, 10) : '2000-01-01'
    }

    const rows = db.prepare(`
      SELECT date, total_market_value, total_cost FROM portfolio_daily_value
      WHERE date >= ? AND date <= ?
      ORDER BY date ASC
    `).all(startDate, endDate) as { date: string; total_market_value: number; total_cost: number }[]

    if (rows.length <= 1) {
      // Fallback: generate REAL data points from historical price data
      try {
        const positions = this.getPositionsWithDetails()
        const totalCost = positions.reduce((s, p) => s + p.cost_amount, 0)
        if (totalCost > 0) {
          const historyResult = this.generatePerformanceFromHistory(db, positions, startDate, endDate)
          if (historyResult.dates.length > 0) return historyResult
        }
      } catch (fallbackErr: any) {
        console.error('[getPortfolioPerformance] Fallback failed:', fallbackErr.message)
      }
      return { dates: [], values: [], cumulativeReturns: [] }
    }

    const firstCost = rows[0].total_cost || rows[0].total_market_value
    const dates = rows.map((r) => r.date)
    const values = rows.map((r) => r.total_market_value)
    const cumulativeReturns = rows.map((r) =>
      firstCost > 0 ? Math.round(((r.total_market_value - firstCost) / firstCost) * 10000) / 100 : 0
    )

    return { dates, values, cumulativeReturns }
  }

  /**
   * Generate portfolio performance from REAL historical data.
   * Reconstructs portfolio on each date: quantity & cost from trades up to that date,
   * prices from fund_navs/kline_bars. Returns at most ~15 evenly spaced points.
   */
  private generatePerformanceFromHistory(
    db: ReturnType<typeof getDb>,
    positions: PositionWithAsset[],
    startDate: string,
    endDate: string
  ): { dates: string[]; values: number[]; cumulativeReturns: number[] } {
    // Get all active trades sorted by time
    const allTrades = db.prepare(`
      SELECT t.*, a.symbol, a.market, a.asset_type
      FROM trades t JOIN assets a ON t.asset_id = a.id
      WHERE t.status = 'active'
      ORDER BY t.trade_time ASC
    `).all() as (Trade & { symbol: string; market: string; asset_type: string })[]

    if (allTrades.length === 0) return { dates: [], values: [], cumulativeReturns: [] }

    const earliestTradeDate = allTrades[0].trade_time.slice(0, 10)
    const today = new Date().toISOString().slice(0, 10)

    // Build a running map of asset_id -> { quantity, cost_amount } for each date
    // Simulate portfolio replay: walk through trades in order, update running state
    const MAX_POINTS = 15
    const points: { date: string; assetValues: Map<string, { qty: number; cost: number; price: number }> }[] = []

    // Pre-group trades by date for efficient lookup
    const tradesByDate = new Map<string, (typeof allTrades[0])[]>()
    for (const t of allTrades) {
      const d = t.trade_time.slice(0, 10)
      if (!tradesByDate.has(d)) tradesByDate.set(d, [])
      tradesByDate.get(d)!.push(t)
    }

    // Get all NAV history dates for funds we hold (to find available price dates)
    const fundAssets = allTrades.filter(t => t.asset_type === 'fund')
      .map(t => ({ symbol: t.symbol, market: t.market }))
      .filter((v, i, a) => a.findIndex(x => x.symbol === v.symbol) === i) // unique

    const allPriceDates = new Set<string>()

    if (fundAssets.length > 0) {
      const clauses = fundAssets.map(() => '(symbol = ? AND market = ?)').join(' OR ')
      const params = fundAssets.flatMap(a => [a.symbol, a.market])
      params.push(earliestTradeDate, today)
      const navDates = db.prepare(`
        SELECT DISTINCT nav_date FROM fund_navs
        WHERE (${clauses})
        AND nav_date >= ? AND nav_date <= ?
        ORDER BY nav_date ASC
      `).all(...params) as { nav_date: string }[]
      for (const r of navDates) allPriceDates.add(r.nav_date)
    }

    // Also add all trade dates (positions changed)
    for (const t of allTrades) {
      allPriceDates.add(t.trade_time.slice(0, 10))
    }

    allPriceDates.add(today)

    // Filter by selected date range (1M/6M/1Y/ALL)
    const filteredDates = Array.from(allPriceDates)
      .filter(d => d >= startDate && d <= endDate)
      .sort()

    // If no dates in range, log and return empty
    if (filteredDates.length === 0) {
      console.warn(`[generatePerformanceFromHistory] No price data in range ${startDate}~${endDate}`)
      return { dates: [], values: [], cumulativeReturns: [] }
    }

    // Generate ~15 evenly spaced dates from the filtered range
    const numPoints = Math.min(MAX_POINTS, filteredDates.length)
    const step = filteredDates.length > 1 ? (filteredDates.length - 1) / Math.max(numPoints - 1, 1) : 0

    const selectedDates: string[] = []
    for (let i = 0; i < numPoints; i++) {
      const idx = Math.min(Math.round(i * step), filteredDates.length - 1)
      selectedDates.push(filteredDates[idx])
    }
    // Ensure endDate (today or range end) is the last point
    const lastTarget = endDate < today ? endDate : today
    if (selectedDates[selectedDates.length - 1] !== lastTarget) {
      selectedDates.push(lastTarget)
    }

    // Now walk through each selected date, reconstruct portfolio
    
    // Running state: asset_id -> { qty, cost }
    const runningState = new Map<string, { qty: number; cost: number }>()
    let lastDate = earliestTradeDate

    // Get all NAV/kline data for price lookups
    // Build price lookup: asset_key + date -> price
    const priceCache = new Map<string, number>() // key = `${symbol}:${market}:${date}` or `${asset_id}:${date}`

    // Fund NAVs
    if (fundAssets.length > 0) {
      const clauses = fundAssets.map(() => '(symbol = ? AND market = ?)').join(' OR ')
      const params = fundAssets.flatMap(a => [a.symbol, a.market])
      params.push(earliestTradeDate, today)
      const navRows = db.prepare(`
        SELECT symbol, market, nav_date, nav FROM fund_navs
        WHERE (${clauses}) AND nav_date >= ? AND nav_date <= ?
      `).all(...params) as { symbol: string; market: string; nav_date: string; nav: number }[]
      for (const r of navRows) {
        priceCache.set(`${r.symbol}:${r.market}:${r.nav_date}`, r.nav)
      }
    }

    // Stock klines
    const stockAssetIds = allTrades.filter(t => t.asset_type !== 'fund')
      .map(t => t.asset_id)
      .filter((v, i, a) => a.indexOf(v) === i)
    if (stockAssetIds.length > 0) {
      const ph = stockAssetIds.map(() => '?').join(',')
      const params = [...stockAssetIds, earliestTradeDate, today]
      const klineRows = db.prepare(`
        SELECT asset_id, bar_time, close FROM kline_bars
        WHERE asset_id IN (${ph}) AND period = '1d'
        AND bar_time >= ? AND bar_time <= ?
      `).all(...params) as { asset_id: string; bar_time: string; close: number }[]
      for (const r of klineRows) {
        priceCache.set(`${r.asset_id}:${r.bar_time}`, r.close)
      }
    }

    // Log warning if no historical price data was loaded
    if (priceCache.size === 0) {
      console.warn(`[generatePerformanceFromHistory] No historical price data in fund_navs/kline_bars for range ${startDate}~${endDate}. Returns will use avg cost (flat 0%). Market sync may still be in progress.`)
    }

    const resultDates: string[] = []
    const resultValues: number[] = []
    const resultReturns: number[] = []

    for (const date of selectedDates) {
      // Apply trades that happened on or before this date but after lastDate
      // Walk through all trades up to and including this date
      const tradesUpToDate = allTrades.filter(t => t.trade_time.slice(0, 10) <= date)

      // Rebuild running state from trades up to this date
      // (Simple approach: reset and replay all trades up to this date)
      const state = new Map<string, { qty: number; cost: number }>()
      let totalCostUpToDate = 0

      for (const t of tradesUpToDate) {
        const prev = state.get(t.asset_id) ?? { qty: 0, cost: 0 }
        if (t.side === 'buy') {
          const tradeCost = t.quantity * t.price + (t.fee ?? 0) + (t.tax ?? 0)
          state.set(t.asset_id, {
            qty: prev.qty + t.quantity,
            cost: prev.cost + tradeCost,
          })
          totalCostUpToDate += tradeCost
        } else {
          // sell: reduce proportionally
          if (prev.qty > 0) {
            const avgCost = prev.cost / prev.qty
            const sellQty = Math.min(t.quantity, prev.qty)
            const costReduction = sellQty * avgCost
            state.set(t.asset_id, {
              qty: prev.qty - sellQty,
              cost: prev.cost - costReduction,
            })
            // For return calculation, we realize the P&L on sale but keep it simple:
            // totalCostUpToDate stays as-is (net invested)
          }
        }
      }

      // Calculate total market value on this date
      let totalValue = 0
      for (const [assetId, s] of state) {
        if (s.qty <= 0) continue
        // Find the asset's symbol/market
        const trade = allTrades.find(t => t.asset_id === assetId)
        if (!trade) continue

        let price = 0
        if (trade.asset_type === 'fund') {
          // Try exact date first, then most recent before this date
          const exactKey = `${trade.symbol}:${trade.market}:${date}`
          price = priceCache.get(exactKey) ?? 0

          if (price <= 0) {
            // Find most recent price before this date
            const allKeys = Array.from(priceCache.keys())
              .filter(k => k.startsWith(`${trade.symbol}:${trade.market}:`) && k.split(':')[2] <= date)
              .sort()
            const lastKey = allKeys[allKeys.length - 1]
            if (lastKey) price = priceCache.get(lastKey) ?? 0
          }
        } else {
          const exactKey = `${assetId}:${date}`
          price = priceCache.get(exactKey) ?? 0
          if (price <= 0) {
            const allKeys = Array.from(priceCache.keys())
              .filter(k => k.startsWith(`${assetId}:`) && k.split(':')[1] <= date)
              .sort()
            const lastKey = allKeys[allKeys.length - 1]
            if (lastKey) price = priceCache.get(lastKey) ?? 0
          }
        }

        // Fallback: use current price if historical price unavailable
        // (avoids -100% when fund_navs/kline_bars not yet synced)
        if (price <= 0 && s.cost > 0 && s.qty > 0) {
          price = s.cost / s.qty // avg cost as price => 0% return for that date
        }

        if (price > 0) {
          totalValue += s.qty * price
        }
      }

      // For dates before any trade, skip
      if (totalValue <= 0 && totalCostUpToDate <= 0) continue

      const ret = totalCostUpToDate > 0
        ? Math.round(((totalValue - totalCostUpToDate) / totalCostUpToDate) * 10000) / 100
        : 0
      resultDates.push(date)
      resultValues.push(Math.round(totalValue * 100) / 100)
      resultReturns.push(ret)
    }

    // Override today's point with actual current position data (source of truth)
    if (resultDates.length > 0 && resultDates[resultDates.length - 1] === today) {
      const lastIdx = resultDates.length - 1
      const currentTotalValue = positions.reduce((s, p) => s + p.market_value, 0)
      const currentTotalCost = positions.reduce((s, p) => s + p.cost_amount, 0)
      if (currentTotalValue > 0 && currentTotalCost > 0) {
        resultValues[lastIdx] = Math.round(currentTotalValue * 100) / 100
        resultReturns[lastIdx] = Math.round(((currentTotalValue - currentTotalCost) / currentTotalCost) * 10000) / 100
      }
    }

    if (resultDates.length < 2) return { dates: [], values: [], cumulativeReturns: [] }
    return { dates: resultDates, values: resultValues, cumulativeReturns: resultReturns }
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
    // Auto-fill name from proxy data if not provided
    const fundName = name || navDataResult?.name || symbol
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
   * Chinese public holidays 2026 (hardcoded for accuracy).
   * Values are dates in 'YYYY-MM-DD' format that are NON-TRADING days.
   */
  private static CHINA_HOLIDAYS_2026 = new Set([
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

  private isTradingDay(dateStr: string): boolean {
    const d = new Date(dateStr)
    const dow = d.getDay()
    if (dow === 0 || dow === 6) return false
    return !PortfolioService.CHINA_HOLIDAYS_2026.has(dateStr)
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
  private computeFundConfirmationDate(purchaseTime: string): { tradeDate: string; confirmationDate: string } {
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

    // Record daily portfolio snapshot
    this.recordDailyPortfolioValue()

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
   * Get yesterday's NAV for a fund from fund_navs table.
   * Falls back to fetching from proxy if not available locally.
   */
  private getYesterdayNav(symbol: string, market: string): number {
    const db = getDb()
    // Use local date (China timezone) instead of UTC
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const year = yesterday.getFullYear()
    const month = String(yesterday.getMonth() + 1).padStart(2, '0')
    const day = String(yesterday.getDate()).padStart(2, '0')
    const yesterdayStr = `${year}-${month}-${day}`

    // Try local cache first
    const cached = db.prepare(`
      SELECT nav FROM fund_navs
      WHERE symbol = ? AND market = ? AND nav_date = ?
    `).get(symbol, market, yesterdayStr) as { nav: number } | undefined

    if (cached) {
      return cached.nav
    }

    // Try to find the most recent NAV before yesterday
    const recent = db.prepare(`
      SELECT nav FROM fund_navs
      WHERE symbol = ? AND market = ? AND nav_date < ?
      ORDER BY nav_date DESC
      LIMIT 1
    `).get(symbol, market, yesterdayStr) as { nav: number } | undefined

    if (recent) {
      return recent.nav
    }

    return 0
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
   * Recalculate position from all active trades (weighted average cost)
   */
  private recalculatePosition(assetId: string, accountId: string): void {
    const db = getDb()

    const activeTrades = db.prepare(`
      SELECT * FROM trades
      WHERE asset_id = ? AND account_id = ? AND status = 'active'
      ORDER BY trade_time ASC
    `).all(assetId, accountId) as Trade[]

    let quantity = 0
    let costAmount = 0

    for (const t of activeTrades) {
      const tradeCost = t.quantity * t.price + t.fee + t.tax
      if (t.side === 'buy') {
        quantity += t.quantity
        costAmount += tradeCost
      } else {
        // Sell: reduce quantity, cost decreases proportionally
        if (quantity > 0) {
          const avgCost = costAmount / quantity
          quantity -= t.quantity
          costAmount -= t.quantity * avgCost
        }
        if (quantity < 0) quantity = 0
        if (costAmount < 0) costAmount = 0
      }
    }

    const avgCost = quantity > 0 ? costAmount / quantity : 0
    const now = new Date().toISOString()

    // Get latest quote for market value
    const quote = db.prepare(`
      SELECT price FROM market_quotes
      WHERE asset_id = ?
      ORDER BY quote_time DESC
      LIMIT 1
    `).get(assetId) as { price: number } | undefined

    // Use quote price if valid (> 0), otherwise fallback to avgCost
    const marketPrice = (quote?.price && quote.price > 0) ? quote.price : avgCost
    const marketValue = quantity * marketPrice
    const unrealizedPnl = marketValue - costAmount

    console.log(`[recalculatePosition] asset=${assetId}, trades=${activeTrades.length}, qty=${quantity.toFixed(4)}, cost=${costAmount.toFixed(2)}, avgCost=${avgCost.toFixed(4)}, quotePrice=${quote?.price ?? 'null'}, marketPrice=${marketPrice.toFixed(4)}, marketValue=${marketValue.toFixed(2)}, pnl=${unrealizedPnl.toFixed(2)}`)

    // Upsert position
    const existing = db.prepare(`
      SELECT id FROM positions WHERE asset_id = ? AND account_id = ?
    `).get(assetId, accountId) as { id: string } | undefined

    if (existing) {
      if (quantity > 0) {
        db.prepare(`
          UPDATE positions
          SET quantity = ?, avg_cost = ?, cost_amount = ?, market_value = ?, unrealized_pnl = ?, updated_at = ?
          WHERE id = ?
        `).run(quantity, avgCost, costAmount, marketValue, unrealizedPnl, now, existing.id)
        console.log(`[recalculatePosition] Updated position ${existing.id}`)
      } else {
        // Zero quantity — delete position
        db.prepare('DELETE FROM positions WHERE id = ?').run(existing.id)
        console.log(`[recalculatePosition] Deleted position ${existing.id} (zero qty)`)
      }
    } else if (quantity > 0) {
      const newId = uuid()
      db.prepare(`
        INSERT INTO positions (id, asset_id, account_id, quantity, avg_cost, cost_amount, market_value, unrealized_pnl, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(newId, assetId, accountId, quantity, avgCost, costAmount, marketValue, unrealizedPnl, now)
      console.log(`[recalculatePosition] Created position ${newId}`)
    }
  }

  /**
   * @deprecated 请使用 previewImport + commitImport 流程替代，该流程支持更灵活的字段映射
   * Import CSV trades from raw text content (backward compatibility).
   * Uses the same BROKER_ALIASES-based field detection as previewImport/commitImport.
   */
  importCSV(csvText: string, accountId: string): IpcImportCsvResult {
    const db = getDb()
    const rows = csvText.trim().split(/\r?\n/)
    if (rows.length < 2) {
      return { success: false, imported: 0, errors: ['CSV is empty or has no data rows'] }
    }

    const headers = parseCSVLine(rows[0])
    const detectedMapping = detectFieldMapping(headers)

    if (Object.keys(detectedMapping).length === 0) {
      return {
        success: false,
        imported: 0,
        errors: ['无法识别 CSV 列头。请确认文件包含证券代码、买卖方向、数量、价格、时间等字段。']
      }
    }

    let imported = 0
    const errors: string[] = []
    const now = new Date().toISOString()
    const recalcSet = new Set<string>()

    const insertTrade = db.prepare(`
      INSERT INTO trades (id, asset_id, account_id, side, quantity, price, fee, tax, trade_time, source, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (let i = 1; i < rows.length; i++) {
      if (!rows[i].trim()) continue
      const values = parseCSVLine(rows[i])
      if (values.length === 0) continue

      const rawData: Record<string, string> = {}
      for (let j = 0; j < headers.length; j++) {
        rawData[headers[j]] = values[j] || ''
      }

      const rowErrors = validateImportRow(rawData, detectedMapping)
      if (rowErrors.length > 0) {
        errors.push(`Line ${i + 1}: ${rowErrors.join('; ')}`)
        continue
      }

      const mapped = applyFieldMapping(rawData, detectedMapping)
      const symbol = mapped.symbol
      const side = mapped.side.toLowerCase() as 'buy' | 'sell'
      const quantity = parseFloat(mapped.quantity)
      const price = parseFloat(mapped.price)
      const fee = mapped.fee ? parseFloat(mapped.fee) : 0
      const tax = mapped.tax ? parseFloat(mapped.tax) : 0
      const tradeTime = mapped.trade_time || now

      // Upsert asset using production repository
      const market = guessMarket(symbol)
      const asset = AssetRepo.upsert({ symbol, market, name: symbol })

      const tradeId = uuid()
      insertTrade.run(tradeId, asset.id, accountId, side, quantity, price, fee, tax, tradeTime, 'csv_import', 'active', now)
      recalcSet.add(`${asset.id}:${accountId}`)
      imported++
    }

    // Recalculate all affected positions
    for (const key of recalcSet) {
      const [assetId, accId] = key.split(':')
      this.recalculatePosition(assetId, accId)
    }

    return {
      success: errors.length === 0,
      imported,
      errors
    }
  }

  /**
   * Recalculate all positions from active trades.
   * Used after bulk import or restore.
   */
  recalculateAllPositions(): number {
    const db = getDb()
    const positions = db.prepare(`
      SELECT DISTINCT asset_id, account_id FROM trades WHERE status = 'active'
    `).all() as { asset_id: string; account_id: string }[]

    for (const pos of positions) {
      this.recalculatePosition(pos.asset_id, pos.account_id)
    }
    return positions.length
  }

  /**
   * Export positions or trades as CSV string
   */
  exportCSV(dataType: 'positions' | 'trades'): string {
    const db = getDb()

    if (dataType === 'positions') {
      const positions = this.getPositionsWithDetails()
      const header = 'symbol,name,market,asset_type,quantity,avg_cost,market_value,unrealized_pnl,weight_pct,daily_pnl,total_return_pct'
      const rows = positions.map((p) =>
        [
          p.asset.symbol,
          p.asset.name,
          p.asset.market,
          p.asset.asset_type,
          p.quantity,
          p.avg_cost.toFixed(2),
          p.market_value.toFixed(2),
          p.unrealized_pnl.toFixed(2),
          p.weight_pct.toFixed(2),
          p.daily_pnl.toFixed(2),
          p.total_return_pct.toFixed(2)
        ].join(',')
      )
      return [header, ...rows].join('\n')
    }

    if (dataType === 'trades') {
      const trades = db.prepare(`
        SELECT t.*, a.symbol FROM trades t
        JOIN assets a ON t.asset_id = a.id
        ORDER BY t.trade_time DESC
      `).all() as (Trade & { symbol: string })[]

      const header = 'symbol,side,quantity,price,fee,tax,trade_time,status'
      const rows = trades.map((t) =>
        [
          t.symbol,
          t.side,
          t.quantity,
          t.price.toFixed(2),
          t.fee.toFixed(2),
          t.tax.toFixed(2),
          t.trade_time,
          t.status
        ].join(',')
      )
      return [header, ...rows].join('\n')
    }

    return ''
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

  // ---- Private helpers ----

  private buildPositionWithAsset(row: any): PositionWithAsset {
    const asset: Asset = {
      id: row.a_id,
      symbol: row.symbol,
      market: row.market,
      name: row.name,
      asset_type: row.asset_type,
      currency: row.currency,
      industry: row.industry,
      style: row.style,
      exchange: row.exchange,
      created_at: row.a_created_at,
      updated_at: row.a_updated_at
    }

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
          source: row.source
        }
      : null

    return {
      id: row.id,
      asset_id: row.asset_id,
      account_id: row.account_id,
      quantity: row.quantity,
      avg_cost: row.avg_cost,
      cost_amount: row.cost_amount,
      market_value: row.market_value,
      unrealized_pnl: row.unrealized_pnl,
      updated_at: row.updated_at,
      asset,
      quote,
      weight_pct: 0,
      daily_pnl: 0,
      yesterday_pnl: 0,
      total_return_pct: 0,
      risk_tag: 'low',
      news_sentiment: null
    }
  }

  private computeRiskTag(totalReturnPct: number, assetType: string): 'low' | 'medium' | 'high' | 'critical' {
    const absReturn = Math.abs(totalReturnPct)
    if (assetType === 'fund') {
      if (absReturn < 5) return 'low'
      if (absReturn < 15) return 'medium'
      return 'high'
    }
    // stocks, etf, lof
    if (absReturn < 10) return 'low'
    if (absReturn < 25) return 'medium'
    if (absReturn < 50) return 'high'
    return 'critical'
  }

  private getLatestNewsSentiment(assetId: string): 'positive' | 'neutral' | 'negative' | null {
    const db = getDb()
    const row = db.prepare(`
      SELECT n.sentiment FROM news_items n
      JOIN news_asset_links l ON n.id = l.news_id
      WHERE l.asset_id = ?
      ORDER BY n.published_at DESC
      LIMIT 1
    `).get(assetId) as { sentiment: number | null } | undefined

    if (!row || row.sentiment === null) return null
    if (row.sentiment > 0.2) return 'positive'
    if (row.sentiment < -0.2) return 'negative'
    return 'neutral'
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

  private computeSimpleRiskScore(positions: PositionWithAsset[]): { score: number; level: 'low' | 'medium' | 'high' | 'critical' } {
    if (positions.length === 0) return { score: 0, level: 'low' }

    // Simple heuristic: higher concentration = higher risk
    const totalValue = positions.reduce((s, p) => s + p.market_value, 0)
    const weights = positions.map((p) => p.market_value / totalValue)
    const hhi = weights.reduce((s, w) => s + w * w, 0) * 100 // Herfindahl 0-100
    const score = Math.max(0, Math.min(100, Math.round(100 - hhi)))

    let level: 'low' | 'medium' | 'high' | 'critical'
    if (score >= 70) level = 'low'
    else if (score >= 50) level = 'medium'
    else if (score >= 30) level = 'high'
    else level = 'critical'

    return { score, level }
  }

  // ---- File Import: Preview & Commit ----

  // BROKER_ALIASES, parseCSVLine, detectFieldMapping, applyFieldMapping, validateImportRow
  // are now imported from ../utils/import-utils

  /**
   * Preview import file — detect headers, map fields, validate rows.
   */
  previewImport(filePath: string): ImportPreviewResult {
    const ext = path.extname(filePath).toLowerCase()
    const rows = this.readFileRows(filePath, ext)

    if (rows.length < 2) {
      return {
        headers: [],
        detected_mapping: {},
        rows: [],
        total_rows: 0,
        valid_rows: 0,
        error_rows: 0,
      }
    }

    const headers = parseCSVLine(rows[0])
    const detectedMapping = detectFieldMapping(headers)
    const resultRows: ImportRowError[] = []
    let validRows = 0
    let errorRows = 0

    for (let i = 1; i < rows.length; i++) {
      if (!rows[i].trim()) continue
      const values = parseCSVLine(rows[i])
      if (values.length === 0) continue

      const rawData: Record<string, string> = {}
      for (let j = 0; j < headers.length; j++) {
        rawData[headers[j]] = values[j] || ''
      }

      const errors = validateImportRow(rawData, detectedMapping)
      if (errors.length > 0) {
        errorRows++
        resultRows.push({ row_index: i, raw_data: rawData, errors })
      } else {
        validRows++
      }
    }

    return {
      headers,
      detected_mapping: detectedMapping,
      rows: resultRows,
      total_rows: validRows + errorRows,
      valid_rows: validRows,
      error_rows: errorRows,
    }
  }

  /**
   * Commit import — map fields, insert trades, recalculate positions.
   */
  commitImport(filePath: string, fieldMapping: Record<string, string>, accountId: string): ImportCommitResult {
    const db = getDb()
    const jobId = uuid()
    const ext = path.extname(filePath).toLowerCase()
    const rows = this.readFileRows(filePath, ext)
    const now = new Date().toISOString()

    if (rows.length < 2) {
      return { job_id: jobId, imported: 0, skipped: 0, errors: [], positions_updated: 0 }
    }

    const headers = parseCSVLine(rows[0])

    // Save import job
    db.prepare(`
      INSERT INTO import_jobs (id, account_id, file_name, file_type, total_rows, status, field_mapping_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)
    `).run(jobId, accountId, path.basename(filePath), ext.replace('.', ''), rows.length - 1, JSON.stringify(fieldMapping), now, now)

    const insertTrade = db.prepare(`
      INSERT INTO trades (id, asset_id, account_id, side, quantity, price, fee, tax, trade_time, source, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'file_import', 'active', ?)
    `)
    const insertError = db.prepare(`
      INSERT INTO import_errors (id, job_id, row_index, raw_data_json, error_messages_json)
      VALUES (?, ?, ?, ?, ?)
    `)

    let imported = 0
    let skipped = 0
    const errors: ImportRowError[] = []
    const recalcSet = new Set<string>()

    const tx = db.transaction(() => {
      for (let i = 1; i < rows.length; i++) {
        if (!rows[i].trim()) continue
        const values = parseCSVLine(rows[i])
        if (values.length === 0) continue

        const rawData: Record<string, string> = {}
        for (let j = 0; j < headers.length; j++) {
          rawData[headers[j]] = values[j] || ''
        }

        const mapped = applyFieldMapping(rawData, fieldMapping)
        const rowErrors = validateImportRow(rawData, fieldMapping)

        if (rowErrors.length > 0) {
          skipped++
          errors.push({ row_index: i, raw_data: rawData, errors: rowErrors })
          insertError.run(uuid(), jobId, i, JSON.stringify(rawData), JSON.stringify(rowErrors))
          continue
        }

        const symbol = mapped.symbol
        const side = mapped.side?.toLowerCase() as 'buy' | 'sell'
        const quantity = parseFloat(mapped.quantity)
        const price = parseFloat(mapped.price)
        const fee = mapped.fee ? parseFloat(mapped.fee) : 0
        const tax = mapped.tax ? parseFloat(mapped.tax) : 0
        const tradeTime = mapped.trade_time || now

        // Upsert asset
        const market = guessMarket(symbol)
        const existingAsset = AssetRepo.getBySymbol(symbol, market)
        const assetId = existingAsset
          ? existingAsset.id
          : AssetRepo.upsert({ symbol, market, name: symbol }).id

        insertTrade.run(uuid(), assetId, accountId, side, quantity, price, fee, tax, tradeTime, now)
        recalcSet.add(`${assetId}:${accountId}`)
        imported++
      }
    })

    tx()

    // Recalculate positions
    let positionsUpdated = 0
    for (const key of recalcSet) {
      const [assetId, accId] = key.split(':')
      this.recalculatePosition(assetId, accId)
      positionsUpdated++
    }

    // Update job status
    db.prepare(`
      UPDATE import_jobs SET status = 'completed', imported_rows = ?, skipped_rows = ?, error_rows = ?, updated_at = ?
      WHERE id = ?
    `).run(imported, skipped, errors.length, new Date().toISOString(), jobId)

    return { job_id: jobId, imported, skipped: skipped, errors, positions_updated: positionsUpdated }
  }

  // ---- Import helpers ----

  private readFileRows(filePath: string, ext: string): string[] {
    const content = fs.readFileSync(filePath, 'utf-8')

    if (ext === '.csv' || ext === '.txt') {
      return content.trim().split(/\r?\n/)
    }

    if (ext === '.xlsx' || ext === '.xls') {
      throw new Error('MVP 版本仅支持 CSV 导入。请将 Excel 文件另存为 CSV 格式后重试。如需 Excel 支持，请运行 npm install xlsx。')
    }

    throw new Error(`不支持的文件格式: ${ext}`)
  }

}
