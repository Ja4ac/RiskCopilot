// ============================================================
// RiskService — risk metrics, exposure, correlation, stress tests
// ============================================================

import { v4 as uuid } from 'uuid'
import { getDb } from '../db'
import type {
  RiskSummary,
  ExposureItem,
  CorrelationPair,
  StressTestResult,
  PositionWithAsset,
  MarketQuote
} from '../../shared/types/database'

export class RiskService {
  /**
   * Compute comprehensive risk summary from portfolio data
   */
  getSummary(): RiskSummary {
    const db = getDb()
    const positions = this.getPositionsWithQuotes(db)
    const portfolioValue = positions.reduce((sum, p) => sum + p.market_value, 0)

    // Get historical daily returns from kline bars (1d period)
    const dailyReturns = this.getPortfolioDailyReturns(db, positions)

    const volatility = this.calcVolatility(dailyReturns)
    const maxDrawdown = this.calcMaxDrawdown(dailyReturns)
    const sharpeRatio = this.calcSharpeRatio(dailyReturns)
    const beta = this.calcBeta(db, dailyReturns)
    const var95 = this.calcVaR95(dailyReturns, portfolioValue)
    const concentrationScore = this.calcConcentrationScore(positions, portfolioValue)
    const correlationScore = this.calcCorrelationScore(db, positions)
    const volatilityScore = this.scoreVolatility(volatility)
    const drawdownScore = this.scoreDrawdown(maxDrawdown)
    const liquidityScore = this.calcLiquidityScore(db, positions)
    const sentimentScore = this.calcSentimentScore(db)
    const alertScore = this.calcAlertScore(db)

    // health_score: higher = better (safer portfolio)
    const healthScore = Math.round(
      0.20 * volatilityScore +
      0.20 * drawdownScore +
      0.15 * concentrationScore +
      0.15 * correlationScore +
      0.10 * liquidityScore +
      0.10 * sentimentScore +
      0.10 * alertScore
    )

    // risk_score: 0 = low risk, 100 = high risk (inverse of health_score)
    const riskScore = Math.max(0, Math.min(100, 100 - healthScore))

    return {
      risk_score: riskScore,
      health_score: healthScore,
      risk_level: this.riskLevel(riskScore),
      volatility, // decimal: e.g. 0.15 for 15%
      max_drawdown: maxDrawdown, // decimal: e.g. 0.20 for 20%
      sharpe_ratio: Math.round(sharpeRatio * 100) / 100,
      beta: Math.round(beta * 100) / 100,
      var_95: Math.round(var95 * 100) / 100,
      concentration_score: Math.round(concentrationScore * 100) / 100,
      correlation_score: Math.round(correlationScore * 100) / 100,
      volatility_score: Math.round(volatilityScore * 100) / 100,
      drawdown_score: Math.round(drawdownScore * 100) / 100,
      liquidity_score: Math.round(liquidityScore * 100) / 100,
      sentiment_score: Math.round(sentimentScore * 100) / 100,
      alert_score: Math.round(alertScore * 100) / 100
    }
  }

  /**
   * Exposure breakdown by industry, asset_type, market
   */
  getExposure(): ExposureItem[] {
    const db = getDb()
    const positions = this.getPositionsWithQuotes(db)
    const totalValue = positions.reduce((s, p) => s + p.market_value, 0)
    if (totalValue === 0) return []

    const result: ExposureItem[] = []

    // By industry
    const industryMap = new Map<string, number>()
    for (const p of positions) {
      const industry = p.asset.industry ?? '其他'
      industryMap.set(industry, (industryMap.get(industry) ?? 0) + p.market_value)
    }
    for (const [cat, val] of industryMap) {
      result.push({
        category: cat,
        category_type: 'industry',
        weight_pct: Math.round((val / totalValue) * 10000) / 100,
        market_value: Math.round(val * 100) / 100
      })
    }

    // By asset_type
    const typeMap = new Map<string, number>()
    for (const p of positions) {
      typeMap.set(p.asset.asset_type, (typeMap.get(p.asset.asset_type) ?? 0) + p.market_value)
    }
    for (const [cat, val] of typeMap) {
      result.push({
        category: cat,
        category_type: 'asset_type',
        weight_pct: Math.round((val / totalValue) * 10000) / 100,
        market_value: Math.round(val * 100) / 100
      })
    }

    // By market
    const marketMap = new Map<string, number>()
    for (const p of positions) {
      marketMap.set(p.asset.market, (marketMap.get(p.asset.market) ?? 0) + p.market_value)
    }
    for (const [cat, val] of marketMap) {
      result.push({
        category: cat,
        category_type: 'market',
        weight_pct: Math.round((val / totalValue) * 10000) / 100,
        market_value: Math.round(val * 100) / 100
      })
    }

    // Sort by weight descending
    result.sort((a, b) => b.weight_pct - a.weight_pct)
    return result
  }

  /**
   * NxN correlation matrix for position assets
   */
  getCorrelation(): CorrelationPair[] {
    const db = getDb()
    const positions = this.getPositionsWithQuotes(db)
    if (positions.length < 2) return []

    // Get daily returns for each asset from kline data
    const assetReturns: Map<string, number[]> = new Map()
    for (const p of positions) {
      const returns = this.getAssetDailyReturns(db, p.asset_id)
      if (returns.length >= 5) {
        assetReturns.set(p.asset_id, returns)
      }
    }

    const assetIds = Array.from(assetReturns.keys())
    const result: CorrelationPair[] = []

    for (let i = 0; i < assetIds.length; i++) {
      for (let j = i + 1; j < assetIds.length; j++) {
        const a = assetIds[i]
        const b = assetIds[j]
        const corr = this.pearsonCorrelation(assetReturns.get(a)!, assetReturns.get(b)!)

        const posA = positions.find((p) => p.asset_id === a)
        const posB = positions.find((p) => p.asset_id === b)

        result.push({
          asset_a: a,
          asset_b: b,
          asset_a_name: posA?.asset.name ?? a,
          asset_b_name: posB?.asset.name ?? b,
          correlation: Math.round(corr * 10000) / 10000
        })
      }
    }

    return result
  }

  /**
   * Run stress tests for given scenarios
   */
  stressTest(scenarioIds: string[]): StressTestResult[] {
    const db = getDb()
    const positions = this.getPositionsWithQuotes(db)
    const portfolioValue = positions.reduce((s, p) => s + p.market_value, 0)
    if (portfolioValue === 0 || scenarioIds.length === 0) return []

    // Get scenarios from DB or use built-in defaults
    const scenarios = this.getScenarios(db, scenarioIds)
    const results: StressTestResult[] = []

    for (const scenario of scenarios) {
      let totalLoss = 0
      const contributors: { asset_name: string; loss_amount: number; loss_pct: number }[] = []

      for (const pos of positions) {
        let shockPct = 0
        for (const shock of scenario.shocks) {
          if (
            (shock.target_type === 'asset' && shock.target === pos.asset_id) ||
            (shock.target_type === 'market' && shock.target === pos.asset.market) ||
            (shock.target_type === 'industry' && shock.target === (pos.asset.industry ?? ''))
          ) {
            shockPct = shock.change_pct
            break
          }
        }

        if (shockPct !== 0) {
          const loss = pos.market_value * (shockPct / 100)
          totalLoss += loss
          contributors.push({
            asset_name: pos.asset.name,
            loss_amount: Math.round(loss * 100) / 100,
            loss_pct: Math.round(shockPct * 100) / 100
          })
        }
      }

      contributors.sort((a, b) => Math.abs(b.loss_amount) - Math.abs(a.loss_amount))

      const suggestions: string[] = []
      if (Math.abs(totalLoss / portfolioValue) > 0.10) {
        suggestions.push('建议减少高波动资产仓位以降低风险敞口')
      }
      if (contributors.length > 0 && Math.abs(contributors[0].loss_amount / portfolioValue) > 0.05) {
        suggestions.push(`${contributors[0].asset_name} 在该情景下损失较大，建议关注其集中度风险`)
      }
      suggestions.push('建议设置止损线以控制系统性风险')

      results.push({
        scenario_id: scenario.id,
        scenario_name: scenario.name,
        estimated_loss_amount: Math.round(totalLoss * 100) / 100,
        estimated_loss_pct: portfolioValue > 0 ? Math.round((totalLoss / portfolioValue) * 10000) / 100 : 0,
        new_portfolio_value: Math.round((portfolioValue + totalLoss) * 100) / 100,
        top_contributors: contributors.slice(0, 5),
        suggestions
      })
    }

    return results
  }

  /**
   * Save current risk snapshot to DB
   */
  saveSnapshot(): string {
    const db = getDb()
    const summary = this.getSummary()
    const snapshotId = uuid()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO risk_snapshots (id, portfolio_id, risk_score, volatility, max_drawdown, sharpe_ratio,
        beta, var_95, concentration_score, correlation_score, liquidity_score, sentiment_score, calculated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshotId,
      'default',
      summary.risk_score,
      summary.volatility,
      summary.max_drawdown,
      summary.sharpe_ratio,
      summary.beta,
      summary.var_95,
      summary.concentration_score,
      summary.correlation_score,
      summary.liquidity_score,
      summary.sentiment_score,
      now
    )

    return snapshotId
  }

  // ---- Private helpers ----

  private getPositionsWithQuotes(db: ReturnType<typeof getDb>): (PositionWithAsset)[] {
    const rows = db.prepare(`
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
      WHERE p.quantity != 0
    `).all() as any[]

    return rows.map((row: any) => ({
      id: row.id,
      asset_id: row.asset_id,
      account_id: row.account_id,
      quantity: row.quantity,
      avg_cost: row.avg_cost,
      cost_amount: row.cost_amount,
      market_value: row.market_value,
      unrealized_pnl: row.unrealized_pnl,
      updated_at: row.updated_at,
      asset: {
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
      },
      quote: row.q_id ? {
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
      } : null,
      weight_pct: 0,
      daily_pnl: 0,
      yesterday_pnl: 0,
      total_return_pct: 0,
      risk_tag: 'low' as const,
      news_sentiment: null
    }))
  }

  private getPortfolioDailyReturns(db: ReturnType<typeof getDb>, positions: PositionWithAsset[]): number[] {
    if (positions.length === 0) return []

    // Separate stocks and funds
    const stockPositions = positions.filter(p => p.asset.asset_type !== 'fund')
    const fundPositions = positions.filter(p => p.asset.asset_type === 'fund')

    // Get all dates from both data sources
    const datePrices = new Map<string, Map<string, number>>()

    // Process stocks from kline_bars
    if (stockPositions.length > 0) {
      const stockAssetIds = stockPositions.map(p => p.asset_id)
      const placeholders = stockAssetIds.map(() => '?').join(',')
      const bars = db.prepare(`
        SELECT asset_id, close, bar_time FROM kline_bars
        WHERE asset_id IN (${placeholders}) AND period = '1d'
        ORDER BY asset_id, bar_time ASC
      `).all(...stockAssetIds) as { asset_id: string; close: number; bar_time: string }[]

      for (const bar of bars) {
        if (!datePrices.has(bar.bar_time)) {
          datePrices.set(bar.bar_time, new Map())
        }
        datePrices.get(bar.bar_time)!.set(bar.asset_id, bar.close)
      }
    }

    // Process funds from fund_navs
    for (const pos of fundPositions) {
      const navs = db.prepare(`
        SELECT nav, nav_date FROM fund_navs
        WHERE symbol = ? AND market = ?
        ORDER BY nav_date ASC
      `).all(pos.asset.symbol, pos.asset.market) as { nav: number; nav_date: string }[]

      for (const nav of navs) {
        if (!datePrices.has(nav.nav_date)) {
          datePrices.set(nav.nav_date, new Map())
        }
        datePrices.get(nav.nav_date)!.set(pos.asset_id, nav.nav)
      }
    }

    if (datePrices.size < 2) return []

    // Build weight map
    const totalValue = positions.reduce((s, p) => s + p.market_value, 0)
    const weights = new Map<string, number>()
    for (const p of positions) {
      weights.set(p.asset_id, totalValue > 0 ? p.market_value / totalValue : 0)
    }

    // Compute daily portfolio returns
    const sortedDates = Array.from(datePrices.keys()).sort()
    const dailyReturns: number[] = []

    for (let i = 1; i < sortedDates.length; i++) {
      const prevDate = datePrices.get(sortedDates[i - 1])!
      const curDate = datePrices.get(sortedDates[i])!

      let portfolioReturn = 0
      for (const [assetId, weight] of weights) {
        const prevPrice = prevDate.get(assetId)
        const curPrice = curDate.get(assetId)
        if (prevPrice && curPrice && prevPrice > 0) {
          const assetReturn = (curPrice - prevPrice) / prevPrice
          portfolioReturn += weight * assetReturn
        }
      }
      dailyReturns.push(portfolioReturn)
    }

    return dailyReturns
  }

  private getAssetDailyReturns(db: ReturnType<typeof getDb>, assetId: string): number[] {
    // Try kline bars first
    const bars = db.prepare(`
      SELECT close, bar_time FROM kline_bars
      WHERE asset_id = ? AND period = '1d'
      ORDER BY bar_time ASC
    `).all(assetId) as { close: number; bar_time: string }[]

    if (bars.length >= 2) {
      const returns: number[] = []
      for (let i = 1; i < bars.length; i++) {
        if (bars[i - 1].close > 0) {
          returns.push((bars[i].close - bars[i - 1].close) / bars[i - 1].close)
        }
      }
      return returns
    }

    // Fallback: try fund_navs for funds
    const asset = db.prepare(`SELECT symbol, market, asset_type FROM assets WHERE id = ?`).get(assetId) as { symbol: string; market: string; asset_type: string } | undefined
    if (asset && asset.asset_type === 'fund') {
      const navs = db.prepare(`
        SELECT nav, nav_date FROM fund_navs
        WHERE symbol = ? AND market = ?
        ORDER BY nav_date ASC
      `).all(asset.symbol, asset.market) as { nav: number; nav_date: string }[]

      const returns: number[] = []
      for (let i = 1; i < navs.length; i++) {
        if (navs[i - 1].nav > 0) {
          returns.push((navs[i].nav - navs[i - 1].nav) / navs[i - 1].nav)
        }
      }
      return returns
    }

    return []
  }

  // ---- Metric calculators ----

  private calcVolatility(dailyReturns: number[]): number {
    if (dailyReturns.length < 2) return 0
    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
    const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyReturns.length - 1)
    return Math.sqrt(variance * 252) // Annualized
  }

  private calcMaxDrawdown(dailyReturns: number[]): number {
    if (dailyReturns.length < 2) return 0

    // Convert returns to cumulative value
    let peak = 1
    let maxDD = 0
    let cumValue = 1

    for (const r of dailyReturns) {
      cumValue *= (1 + r)
      if (cumValue > peak) peak = cumValue
      const dd = (peak - cumValue) / peak
      if (dd > maxDD) maxDD = dd
    }

    return maxDD
  }

  private calcSharpeRatio(dailyReturns: number[]): number {
    if (dailyReturns.length < 2) return 0
    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
    const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyReturns.length - 1)
    const std = Math.sqrt(variance)
    if (std === 0) return 0

    // Risk-free rate 2.5% annual → daily
    const rfDaily = 0.025 / 252
    return ((mean - rfDaily) / std) * Math.sqrt(252)
  }

  private calcBeta(db: ReturnType<typeof getDb>, dailyReturns: number[]): number {
    if (dailyReturns.length < 2) return 1.0

    // Use kline bars as benchmark if available
    const bars = db.prepare(`
      SELECT close, bar_time FROM kline_bars
      WHERE period = '1d'
      ORDER BY bar_time ASC
    `).all() as { close: number; bar_time: string }[]

    let benchReturns: number[] = []

    if (bars.length >= 2) {
      // Group by date, compute average price across all assets (proxy benchmark)
      const dateMap = new Map<string, number[]>()
      for (const bar of bars) {
        if (!dateMap.has(bar.bar_time)) dateMap.set(bar.bar_time, [])
        dateMap.get(bar.bar_time)!.push(bar.close)
      }

      const sortedDates = Array.from(dateMap.keys()).sort()
      for (let i = 1; i < sortedDates.length; i++) {
        const prevAvg = dateMap.get(sortedDates[i - 1])!.reduce((a, b) => a + b, 0) / dateMap.get(sortedDates[i - 1])!.length
        const curAvg = dateMap.get(sortedDates[i])!.reduce((a, b) => a + b, 0) / dateMap.get(sortedDates[i])!.length
        if (prevAvg > 0) benchReturns.push((curAvg - prevAvg) / prevAvg)
      }
    }

    // If no kline benchmark, use equal-weighted average of all fund NAVs as proxy benchmark
    if (benchReturns.length < 2) {
      const funds = db.prepare(`
        SELECT DISTINCT symbol, market FROM fund_navs
      `).all() as { symbol: string; market: string }[]

      if (funds.length >= 1) {
        const fundDates = new Map<string, number[]>()
        for (const fund of funds) {
          const navs = db.prepare(`
            SELECT nav, nav_date FROM fund_navs
            WHERE symbol = ? AND market = ?
            ORDER BY nav_date ASC
          `).all(fund.symbol, fund.market) as { nav: number; nav_date: string }[]

          for (let i = 1; i < navs.length; i++) {
            if (!fundDates.has(navs[i].nav_date)) {
              fundDates.set(navs[i].nav_date, [])
            }
            if (navs[i - 1].nav > 0) {
              fundDates.get(navs[i].nav_date)!.push((navs[i].nav - navs[i - 1].nav) / navs[i - 1].nav)
            }
          }
        }

        const sortedDates = Array.from(fundDates.keys()).sort()
        for (const date of sortedDates) {
          const returns = fundDates.get(date)!
          if (returns.length > 0) {
            benchReturns.push(returns.reduce((a, b) => a + b, 0) / returns.length)
          }
        }
      }
    }

    if (benchReturns.length < 2) return 1.0

    // Align lengths
    const n = Math.min(dailyReturns.length, benchReturns.length)
    const portR = dailyReturns.slice(dailyReturns.length - n)
    const benchR = benchReturns.slice(benchReturns.length - n)

    const portMean = portR.reduce((a, b) => a + b, 0) / n
    const benchMean = benchR.reduce((a, b) => a + b, 0) / n
    const cov = portR.reduce((s, r, i) => s + (r - portMean) * (benchR[i] - benchMean), 0) / (n - 1)
    const benchVar = benchR.reduce((s, r) => s + (r - benchMean) ** 2, 0) / (n - 1)

    return benchVar > 0 ? cov / benchVar : 1.0
  }

  private calcVaR95(dailyReturns: number[], portfolioValue: number): number {
    if (dailyReturns.length < 5) return 0
    const sorted = [...dailyReturns].sort((a, b) => a - b)
    const idx = Math.floor(sorted.length * 0.05)
    const varReturn = sorted[idx]
    return Math.abs(varReturn * portfolioValue)
  }

  private calcConcentrationScore(positions: PositionWithAsset[], totalValue: number): number {
    if (totalValue === 0 || positions.length === 0) return 100

    const weights = positions.map((p) => p.market_value / totalValue)
    const hhi = weights.reduce((s, w) => s + w * w, 0)

    // Normalize HHI to 0-100 (HHI = 1 when one asset holds all, HHI = 1/n when equal weight)
    const minHhi = 1 / positions.length
    const normalizedHhi = positions.length > 1
      ? (hhi - minHhi) / (1 - minHhi)
      : 1

    // Score: lower concentration = higher score
    return Math.round((1 - normalizedHhi) * 100)
  }

  private calcCorrelationScore(db: ReturnType<typeof getDb>, positions: PositionWithAsset[]): number {
    const pairs = this.getCorrelation()
    if (pairs.length === 0) return 100

    const avgCorr = pairs.reduce((s, p) => s + Math.abs(p.correlation), 0) / pairs.length
    // Score: lower correlation = higher score (more diversification)
    return Math.round((1 - avgCorr) * 100)
  }

  private calcLiquidityScore(db: ReturnType<typeof getDb>, positions: PositionWithAsset[]): number {
    // Based on average turnover/volume from quotes
    if (positions.length === 0) return 100

    let totalScore = 0
    let count = 0
    for (const p of positions) {
      if (p.quote?.turnover && p.quote.turnover > 0) {
        // Simple heuristic: more turnover = better liquidity
        const turnoverScore = Math.min(100, Math.log10(p.quote.turnover + 1) * 10)
        totalScore += turnoverScore
        count++
      }
    }

    return count > 0 ? Math.round(totalScore / count) : 50
  }

  private calcSentimentScore(db: ReturnType<typeof getDb>): number {
    const rows = db.prepare(`
      SELECT AVG(sentiment) AS avg_sentiment FROM news_items
      WHERE published_at >= datetime('now', '-7 days')
    `).get() as { avg_sentiment: number | null }

    const avgSentiment = rows?.avg_sentiment ?? 0
    // Score: positive sentiment = higher score (capped 0-100)
    return Math.max(0, Math.min(100, Math.round((avgSentiment + 1) * 50)))
  }

  private calcAlertScore(db: ReturnType<typeof getDb>): number {
    const totalAlerts = (db.prepare('SELECT COUNT(*) AS cnt FROM alerts').get() as { cnt: number }).cnt
    const triggeredAlerts = (db.prepare(
      "SELECT COUNT(*) AS cnt FROM alerts WHERE status = 'triggered'"
    ).get() as { cnt: number }).cnt

    if (totalAlerts === 0) return 100
    const triggeredRatio = triggeredAlerts / totalAlerts
    return Math.round((1 - triggeredRatio) * 100)
  }

  // ---- Scoring helpers ----

  private scoreVolatility(vol: number): number {
    // Lower volatility = higher score. vol ~0% = 100, vol ~50% = 0
    return Math.max(0, Math.min(100, Math.round(100 - vol * 200)))
  }

  private scoreDrawdown(dd: number): number {
    // Lower drawdown = higher score. dd 0% = 100, dd 50% = 0
    return Math.max(0, Math.min(100, Math.round(100 - dd * 200)))
  }

  private riskLevel(riskScore: number): 'low' | 'medium' | 'high' | 'critical' {
    // riskScore: 0 = low risk, 100 = high risk
    if (riskScore <= 25) return 'low'
    if (riskScore <= 50) return 'medium'
    if (riskScore <= 75) return 'high'
    return 'critical'
  }

  // ---- Stats helpers ----

  private pearsonCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length)
    if (n < 3) return 0

    const xs = x.slice(x.length - n)
    const ys = y.slice(y.length - n)

    const meanX = xs.reduce((a, b) => a + b, 0) / n
    const meanY = ys.reduce((a, b) => a + b, 0) / n

    let cov = 0, varX = 0, varY = 0
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - meanX
      const dy = ys[i] - meanY
      cov += dx * dy
      varX += dx * dx
      varY += dy * dy
    }

    if (varX === 0 || varY === 0) return 0
    return cov / Math.sqrt(varX * varY)
  }

  // ---- Scenarios ----

  private getScenarios(db: ReturnType<typeof getDb>, scenarioIds: string[]): Array<{
    id: string
    name: string
    description: string
    type: string
    shocks: Array<{ target: string; target_type: string; change_pct: number }>
  }> {
    // Built-in default scenarios
    const defaults: Record<string, any> = {
      'market_crash': {
        id: 'market_crash',
        name: '市场崩盘',
        description: '模拟大盘暴跌20%的情景',
        type: 'hypothetical',
        shocks: [
          { target: 'SH', target_type: 'market', change_pct: -20 },
          { target: 'SZ', target_type: 'market', change_pct: -20 },
          { target: 'HK', target_type: 'market', change_pct: -18 },
          { target: 'US', target_type: 'market', change_pct: -15 }
        ]
      },
      'tech_selloff': {
        id: 'tech_selloff',
        name: '科技股抛售',
        description: '科技板块下跌15%',
        type: 'hypothetical',
        shocks: [
          { target: '信息技术', target_type: 'industry', change_pct: -15 },
          { target: '科技', target_type: 'industry', change_pct: -15 },
          { target: 'TMT', target_type: 'industry', change_pct: -15 }
        ]
      },
      'rate_hike': {
        id: 'rate_hike',
        name: '加息冲击',
        description: '利率大幅上升，股市整体下跌10%',
        type: 'hypothetical',
        shocks: [
          { target: 'SH', target_type: 'market', change_pct: -10 },
          { target: 'SZ', target_type: 'market', change_pct: -10 },
          { target: 'HK', target_type: 'market', change_pct: -12 },
          { target: 'US', target_type: 'market', change_pct: -8 }
        ]
      },
      'moderate_decline': {
        id: 'moderate_decline',
        name: '温和下跌',
        description: '市场温和回调5%',
        type: 'hypothetical',
        shocks: [
          { target: 'SH', target_type: 'market', change_pct: -5 },
          { target: 'SZ', target_type: 'market', change_pct: -5 },
          { target: 'HK', target_type: 'market', change_pct: -5 },
          { target: 'US', target_type: 'market', change_pct: -5 }
        ]
      }
    }

    return scenarioIds.map((id) => defaults[id] ?? {
      id,
      name: id,
      description: '自定义情景',
      type: 'hypothetical',
      shocks: []
    })
  }
}
