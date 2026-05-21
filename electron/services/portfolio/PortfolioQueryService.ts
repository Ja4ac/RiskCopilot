// ============================================================
// PortfolioQueryService — performance, daily snapshots, export
// ============================================================

import { getDb } from '../../db'
import type { PositionWithAsset, Trade } from '../../../shared/types/database'
import { fetchFundNavHistoryFromProxy } from '../data-proxy'

export class PortfolioQueryService {
  private getPositionsWithDetails: () => PositionWithAsset[]

  constructor(getPositionsWithDetails: () => PositionWithAsset[]) {
    this.getPositionsWithDetails = getPositionsWithDetails
  }

  /**
   * Record portfolio value snapshot.
   * @param date Optional date string (YYYY-MM-DD). Defaults to today.
   *             Trade callers should pass the trade date for historical backfill.
   */
  recordDailyPortfolioValue(date?: string): void {
    const db = getDb()
    const positions = this.getPositionsWithDetails()
    const totalMarketValue = positions.reduce((s, p) => s + p.market_value, 0)
    const totalCost = positions.reduce((s, p) => s + p.cost_amount, 0)
    const totalPnl = totalMarketValue - totalCost
    const snapDate = date || new Date().toISOString().slice(0, 10)

    db.prepare(`
      INSERT OR REPLACE INTO portfolio_daily_value (id, date, total_market_value, total_cost, total_pnl)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      `pv_${snapDate}`,
      snapDate,
      Math.round(totalMarketValue * 100) / 100,
      Math.round(totalCost * 100) / 100,
      Math.round(totalPnl * 100) / 100
    )
  }

  /**
   * Get portfolio performance history for charting.
   */
  async getPortfolioPerformance(range: '1m' | '3m' | '6m' | '1y' | 'all' = 'all'): Promise<{
    dates: string[]
    values: number[]
    cumulativeReturns: number[]
  }> {
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

    // Primary engine: generate from trade + price history (covers ALL dates back to earliest trade)
    try {
      const positions = this.getPositionsWithDetails()
      const totalCost = positions.reduce((s, p) => s + p.cost_amount, 0)
      if (totalCost > 0) {
        const historyResult = await this.generatePerformanceFromHistory(db, positions, startDate, endDate)
        if (historyResult.dates.length > 0) return historyResult
      }
    } catch (fallbackErr: any) {
      console.error('[getPortfolioPerformance] History generation failed:', fallbackErr.message)
    }

    // Fallback: use cached portfolio_daily_value rows
    const rows = db.prepare(`
      SELECT date, total_market_value, total_cost FROM portfolio_daily_value
      WHERE date >= ? AND date <= ?
      ORDER BY date ASC
    `).all(startDate, endDate) as { date: string; total_market_value: number; total_cost: number }[]

    if (rows.length >= 2) {
      const firstCost = rows[0].total_cost || rows[0].total_market_value
      return {
        dates: rows.map((r) => r.date),
        values: rows.map((r) => r.total_market_value),
        cumulativeReturns: rows.map((r) =>
          firstCost > 0 ? Math.round(((r.total_market_value - firstCost) / firstCost) * 10000) / 100 : 0
        ),
      }
    }

    return { dates: [], values: [], cumulativeReturns: [] }
  }

  /**
   * Generate portfolio performance from REAL historical data.
   * Reconstructs portfolio on each date: quantity & cost from trades up to that date,
   * prices from fund_navs/kline_bars. Returns at most ~15 evenly spaced points.
   */
  async generatePerformanceFromHistory(
    db: ReturnType<typeof getDb>,
    positions: PositionWithAsset[],
    startDate: string,
    endDate: string
  ): Promise<{ dates: string[]; values: number[]; cumulativeReturns: number[] }> {
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

    const MAX_POINTS = 15

    // Pre-group trades by date for efficient lookup
    const tradesByDate = new Map<string, (typeof allTrades[0])[]>()
    for (const t of allTrades) {
      const d = t.trade_time.slice(0, 10)
      if (!tradesByDate.has(d)) tradesByDate.set(d, [])
      tradesByDate.get(d)!.push(t)
    }

    // Get all unique fund assets from trades
    const fundAssets = allTrades.filter(t => t.asset_type === 'fund')
      .map(t => ({ symbol: t.symbol, market: t.market }))
      .filter((v, i, a) => a.findIndex(x => x.symbol === v.symbol) === i) // unique

    // Auto-sync NAV history for funds that have little or no NAV data
    for (const fa of fundAssets) {
      const count = db.prepare(`SELECT COUNT(*) as c FROM fund_navs WHERE symbol = ? AND market = ?`).get(fa.symbol, fa.market) as { c: number }
      if (count.c < 10) {
        try {
          console.log(`[getPortfolioPerformance] Auto-syncing NAV history for ${fa.symbol}...`)
          await fetchFundNavHistoryFromProxy(fa.symbol, earliestTradeDate, today)
            .catch(() => fetchFundNavHistoryFromProxy(fa.symbol))
        } catch (e: any) {
          console.warn(`[getPortfolioPerformance] NAV sync failed for ${fa.symbol}:`, e.message)
        }
      }
    }

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
}
