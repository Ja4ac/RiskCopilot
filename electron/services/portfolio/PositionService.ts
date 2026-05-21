// ============================================================
// PositionService — positions, summary, recalculation, risk helpers
// ============================================================

import { v4 as uuid } from 'uuid'
import { getDb } from '../../db'
import type {
  PositionWithAsset,
  PortfolioSummary,
  Trade,
  Asset,
  MarketQuote
} from '../../../shared/types/database'

export class PositionService {
  private getPrevNav: (symbol: string, market: string) => number
  private getDayBeforeNav: (symbol: string, market: string) => number

  constructor(
    getPrevNav: (symbol: string, market: string) => number,
    getDayBeforeNav: (symbol: string, market: string) => number
  ) {
    this.getPrevNav = getPrevNav
    this.getDayBeforeNav = getDayBeforeNav
  }

  /**
   * Get all positions joined with asset info and latest quote
   */
  getPositionsWithDetails(): PositionWithAsset[] {
    const db = getDb()

    // Funds: prefer python-proxy-nav source for accuracy
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
      WHERE p.quantity != 0 AND a.asset_type = 'fund'
      ORDER BY a.symbol ASC
    `).all() as any[]

    // Non-funds (stocks/ETFs): just use the latest quote by time
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
      WHERE p.quantity != 0 AND (a.asset_type IS NULL OR a.asset_type != 'fund')
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

      // Pre-compute yesterday's close from daily kline data (for stocks/ETFs)
      let klineYesterdayClose: number | undefined
      let klinePrevClose: number | undefined
      if (pos.asset?.asset_type !== 'fund') {
        const klines = db.prepare(`
          SELECT close, bar_time FROM kline_bars
          WHERE asset_id = ? AND period = '1d'
          ORDER BY bar_time DESC LIMIT 3
        `).all(pos.asset_id) as { close: number; bar_time: string }[]
        const now = new Date()
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        let startIdx = 0
        // Skip today's incomplete bar if present (trading day not complete yet)
        if (klines.length > 0 && klines[0].bar_time.slice(0, 10) === today) startIdx = 1
        if (klines.length > startIdx) klineYesterdayClose = klines[startIdx].close
        if (klines.length > startIdx + 1) klinePrevClose = klines[startIdx + 1].close
      }

      // ── 昨日收益: 最新完整交易日的涨跌(昨日收盘 vs 前日收盘/前日净值) ──
      if (pos.asset?.asset_type === 'fund') {
        // 基金: 从 fund_navs 取最新两条净值
        const rows = db.prepare(`
          SELECT nav FROM fund_navs WHERE symbol=?
          ORDER BY nav_date DESC LIMIT 2
        `).all(pos.asset.symbol) as { nav: number }[]
        pos.yesterday_pnl = rows.length >= 2
          ? Math.round(pos.quantity * (rows[0].nav - rows[1].nav) * 100) / 100
          : 0
      } else {
        // 股票/ETF: 从日K线获取昨日收盘价计算昨日涨跌
        if (klineYesterdayClose !== undefined && klinePrevClose !== undefined) {
          // 精确: 昨日收益 = 数量 * (昨日收盘价 - 前日收盘价)
          pos.yesterday_pnl = Math.round(pos.quantity * (klineYesterdayClose - klinePrevClose) * 100) / 100
        } else {
          // K线数据不足 — 无法计算昨日收益
          pos.yesterday_pnl = 0
        }
      }

      // ── 今日收益: 今日实时涨跌(当前价 vs 昨日收盘价/最新净值) ──
      if (pos.asset?.asset_type === 'fund') {
        // 基金: 优先用 eastmoney 实时估值(gszzl)
        const rt = db.prepare(`
          SELECT mq.change_pct FROM market_quotes mq
          JOIN assets a2 ON a2.id = mq.asset_id
          WHERE a2.symbol = ? AND mq.source = 'eastmoney-fund'
          ORDER BY mq.quote_time DESC LIMIT 1
        `).get(pos.asset.symbol) as { change_pct: number | null } | undefined
        if (rt?.change_pct != null) {
          // 实时估值可用: 用百分比计算(近似)
          pos.daily_pnl = Math.round(pos.market_value * (rt.change_pct / 100) * 100) / 100
        } else {
          // 没有实时估值: 用 fund_navs 计算(仅当最新净值是今日数据)
          const rows = db.prepare(`SELECT nav, nav_date FROM fund_navs WHERE symbol=? ORDER BY nav_date DESC LIMIT 2`)
            .all(pos.asset.symbol) as { nav: number; nav_date: string }[]
          const now = new Date()
          const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
          if (rows.length >= 2 && rows[0].nav_date === today) {
            // 最新净值是今日数据 → 精确计算今日涨跌
            pos.daily_pnl = Math.round(pos.quantity * (rows[0].nav - rows[1].nav) * 100) / 100
          } else {
            // 今日净值未出 → 今日收益暂未知
            pos.daily_pnl = 0
          }
        }
      } else {
        // 股票/ETF: 用当前价和昨日收盘价精确计算日内涨跌
        if (klineYesterdayClose !== undefined && currentPrice > 0) {
          // 精确: 今日收益 = 数量 * (当前价 - 昨日收盘价)
          pos.daily_pnl = Math.round(pos.quantity * (currentPrice - klineYesterdayClose) * 100) / 100
        } else if (pos.quote && pos.quote.change_pct !== null && pos.quote.change_pct !== 0) {
          // 无K线时的近似: daily_pnl = qty * 当前价 * change_pct / (100 + change_pct)
          pos.daily_pnl = Math.round(pos.quantity * currentPrice * (pos.quote.change_pct / (100 + pos.quote.change_pct)) * 100) / 100
        } else {
          pos.daily_pnl = 0
        }
      }

      pos.total_return_pct = pos.avg_cost > 0
        ? Math.round(((currentPrice - pos.avg_cost) / pos.avg_cost) * 10000) / 100
        : 0
      pos.risk_tag = this.computeRiskTag(pos.total_return_pct, pos.asset?.asset_type ?? 'stock')
      pos.news_sentiment = this.getLatestNewsSentiment(pos.asset_id)
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
   * Recalculate position from all active trades (weighted average cost)
   */
  recalculatePosition(assetId: string, accountId: string): void {
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

    // Normalize quote price: some APIs return prices in 分 (cents) instead of 元 (yuan)
    // e.g., 981分 = 9.81元. Detect by checking if price > 100 for non-fund stocks.
    let rawPrice = (quote?.price && quote.price > 0) ? quote.price : 0
    if (rawPrice > 100 && avgCost > 0) {
      const inYuan = rawPrice / 100
      if (inYuan > 0.5 && inYuan < 100 && Math.abs(inYuan / avgCost - 1) < Math.abs(rawPrice / avgCost - 1)) {
        console.warn(`[recalculatePosition] Price ${rawPrice} looks like 分 units, converting to ${inYuan}元`)
        // ALSO fix the stored quote in market_quotes so other queries (getPositionsWithDetails) use correct price
        if (quote) {
          db.prepare(`UPDATE market_quotes SET price = ? WHERE asset_id = ? AND price = ?`)
            .run(inYuan, assetId, rawPrice)
          console.warn(`[recalculatePosition] Fixed market_quotes price for ${assetId}: ${rawPrice} → ${inYuan}`)
        }
        rawPrice = inYuan
      }
    }
    const marketPrice = rawPrice > 0 ? rawPrice : avgCost
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

  // ---- Internal helpers ----

  buildPositionWithAsset(row: any): PositionWithAsset {
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

  computeRiskTag(totalReturnPct: number, assetType: string): 'low' | 'medium' | 'high' | 'critical' {
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

  getLatestNewsSentiment(assetId: string): 'positive' | 'neutral' | 'negative' | null {
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

  computeSimpleRiskScore(positions: PositionWithAsset[]): { score: number; level: 'low' | 'medium' | 'high' | 'critical' } {
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
}
