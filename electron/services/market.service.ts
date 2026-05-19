// ============================================================
// MarketService — quotes, kline, indicators, simulated quotes
// ============================================================

import { v4 as uuid } from 'uuid'
import { getDb } from '../db'
import type {
  MarketQuote,
  KlineBar,
  KlinePeriod,
  IndicatorType,
  IndicatorValues
} from '../../shared/types/database'
import { calcMA, calcEMA, calcMACD, calcBOLL, calcKDJ, calcRSI } from './indicators'

export class MarketService {
  /**
   * Get latest quotes, optionally filtered by asset IDs
   */
  getQuotes(assetIds?: string[]): MarketQuote[] {
    const db = getDb()

    if (assetIds && assetIds.length > 0) {
      const placeholders = assetIds.map(() => '?').join(',')
      // Get latest quote per asset via subquery
      const stmt = db.prepare(`
        SELECT q.* FROM market_quotes q
        INNER JOIN (
          SELECT asset_id, MAX(quote_time) AS max_time
          FROM market_quotes
          WHERE asset_id IN (${placeholders})
          GROUP BY asset_id
        ) latest ON q.asset_id = latest.asset_id AND q.quote_time = latest.max_time
      `)
      return stmt.all(...assetIds) as MarketQuote[]
    }

    const stmt = db.prepare(`
      SELECT q.* FROM market_quotes q
      INNER JOIN (
        SELECT asset_id, MAX(quote_time) AS max_time
        FROM market_quotes
        GROUP BY asset_id
      ) latest ON q.asset_id = latest.asset_id AND q.quote_time = latest.max_time
    `)
    return stmt.all() as MarketQuote[]
  }

  /**
   * Get kline bars for an asset
   */
  getKline(
    assetId: string,
    period: KlinePeriod,
    from?: string,
    to?: string
  ): KlineBar[] {
    const db = getDb()

    let sql = `
      SELECT * FROM kline_bars
      WHERE asset_id = ? AND period = ?
    `
    const params: (string | number)[] = [assetId, period]

    if (from) {
      sql += ' AND bar_time >= ?'
      params.push(from)
    }
    if (to) {
      sql += ' AND bar_time <= ?'
      params.push(to)
    }
    sql += ' ORDER BY bar_time ASC'

    const stmt = db.prepare(sql)
    return stmt.all(...params) as KlineBar[]
  }

  /**
   * Compute technical indicators from kline data
   */
  getIndicators(
    assetId: string,
    period: KlinePeriod,
    types: IndicatorType[]
  ): IndicatorValues {
    const bars = this.getKline(assetId, period)
    const closes = bars.map((b) => b.close)
    const highs = bars.map((b) => b.high)
    const lows = bars.map((b) => b.low)
    const last = closes.length - 1

    const result: IndicatorValues = {
      ma5: null,
      ma10: null,
      ma20: null,
      ma60: null,
      macd_dif: null,
      macd_dea: null,
      macd_histogram: null,
      boll_upper: null,
      boll_middle: null,
      boll_lower: null,
      kdj_k: null,
      kdj_d: null,
      kdj_j: null,
      rsi: null
    }

    if (closes.length === 0) return result

    if (types.includes('MA')) {
      const ma5 = calcMA(closes, 5)
      const ma10 = calcMA(closes, 10)
      const ma20 = calcMA(closes, 20)
      const ma60 = calcMA(closes, 60)
      result.ma5 = ma5[last] ?? null
      result.ma10 = ma10[last] ?? null
      result.ma20 = ma20[last] ?? null
      result.ma60 = ma60[last] ?? null
    }

    if (types.includes('MACD')) {
      const macd = calcMACD(closes)
      result.macd_dif = macd.dif[last] ?? null
      result.macd_dea = macd.dea[last] ?? null
      result.macd_histogram = macd.histogram[last] ?? null
    }

    if (types.includes('BOLL')) {
      const boll = calcBOLL(closes, 20, 2)
      result.boll_upper = boll.upper[last] ?? null
      result.boll_middle = boll.middle[last] ?? null
      result.boll_lower = boll.lower[last] ?? null
    }

    if (types.includes('KDJ')) {
      const kdj = calcKDJ(highs, lows, closes)
      result.kdj_k = kdj.k[last] ?? null
      result.kdj_d = kdj.d[last] ?? null
      result.kdj_j = kdj.j[last] ?? null
    }

    if (types.includes('RSI')) {
      const rsi = calcRSI(closes, 14)
      result.rsi = rsi[last] ?? null
    }

    return result
  }

  /**
   * Update market sync status (placeholder for live data sync timestamp tracking)
   */
  updateMarketStatus(): { last_sync: string; status: string } {
    const now = new Date().toISOString()
    const db = getDb()

    db.prepare(`
      INSERT INTO app_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = ?
    `).run('market_last_sync', now, now)

    return { last_sync: now, status: 'synced' }
  }
}
