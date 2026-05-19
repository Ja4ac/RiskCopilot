import { v4 as uuid } from 'uuid'
import type { MarketQuote, KlineBar, KlinePeriod, AssetIdentifier } from '../../../shared/types/database'
import type { IMarketProvider } from './interface'

/**
 * HTTP market provider — fetches quotes and kline from a custom REST API.
 * Expects the API to conform to a simple JSON schema:
 *
 * GET /quotes?symbols=SH.600519,SZ.300750
 *   → [{ rawCode, price, changePct, volume, turnover, quoteTime }]
 *
 * GET /kline?symbol=SH.600519&period=1d&from=2026-01-01&to=2026-05-14
 *   → [{ open, high, low, close, volume, barTime }]
 *
 * GET /health → { status: "ok" }
 */
export class HttpMarketProvider implements IMarketProvider {
  readonly id: string
  readonly provider = 'http'
  readonly name: string
  private baseUrl: string
  private timeout: number

  constructor(id: string, name: string, baseUrl: string, timeout = 10000) {
    this.id = id
    this.name = name
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.timeout = timeout
  }

  async getQuotes(symbols: AssetIdentifier[]): Promise<MarketQuote[]> {
    if (symbols.length === 0) return []

    const codes = symbols.map((s) => this.normalizeAssetCode(s.symbol, s.market)).join(',')
    const url = `${this.baseUrl}/quotes?symbols=${encodeURIComponent(codes)}`

    const data = await this.fetchJson<Array<{
      rawCode: string; price: number; changePct?: number
      volume?: number; turnover?: number; quoteTime?: string
    }>>(url)

    return data.map((item, i) => ({
      id: uuid(),
      asset_id: '', // filled by caller
      symbol: symbols[i]?.symbol ?? '',
      market: symbols[i]?.market ?? '',
      price: Number(item.price) || 0,
      change_pct: item.changePct != null ? Number(item.changePct) : null,
      volume: item.volume != null ? Number(item.volume) : null,
      turnover: item.turnover != null ? Number(item.turnover) : null,
      quote_time: item.quoteTime || new Date().toISOString(),
      source: `http:${this.name}`,
      provider_symbol: item.rawCode,
    }))
  }

  async getKline(symbol: AssetIdentifier, period: KlinePeriod, from?: string, to?: string): Promise<KlineBar[]> {
    const code = this.normalizeAssetCode(symbol.symbol, symbol.market)
    let url = `${this.baseUrl}/kline?symbol=${encodeURIComponent(code)}&period=${period}`
    if (from) url += `&from=${from}`
    if (to) url += `&to=${to}`

    const data = await this.fetchJson<Array<{
      open: number; high: number; low: number; close: number
      volume?: number; barTime?: string
    }>>(url)

    return data.map((item) => ({
      id: uuid(),
      asset_id: '',
      period,
      open: Number(item.open) || 0,
      high: Number(item.high) || 0,
      low: Number(item.low) || 0,
      close: Number(item.close) || 0,
      volume: item.volume != null ? Number(item.volume) : null,
      bar_time: item.barTime || new Date().toISOString(),
      source: `http:${this.name}`,
    }))
  }

  async healthCheck(): Promise<boolean> {
    try {
      const resp = await this.fetchTimeout(`${this.baseUrl}/health`, this.timeout)
      if (!resp.ok) return false
      const json = await resp.json() as { status?: string }
      return json?.status === 'ok'
    } catch {
      return false
    }
  }

  normalizeAssetCode(symbol: string, market: string): string {
    return `${market.toUpperCase()}.${symbol}`
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const resp = await this.fetchTimeout(url, this.timeout)
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText} — ${url}`)
    }
    return resp.json() as Promise<T>
  }

  private fetchTimeout(url: string, ms: number): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ms)
    return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer))
  }
}
