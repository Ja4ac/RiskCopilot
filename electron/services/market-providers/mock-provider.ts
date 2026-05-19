import { v4 as uuid } from 'uuid'
import type { MarketQuote, KlineBar, KlinePeriod, AssetIdentifier } from '../../../shared/types/database'
import type { IMarketProvider } from './interface'

/**
 * Mock market provider — generates simulated quotes and kline bars.
 * Used as fallback when no real data source is configured.
 */
export class MockMarketProvider implements IMarketProvider {
  readonly id = 'mock-market'
  readonly provider = 'mock'
  readonly name = '本地模拟行情'

  private seedRand(seed: number): () => number {
    let s = seed
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      return s / 0x7fffffff
    }
  }

  async getQuotes(symbols: AssetIdentifier[]): Promise<MarketQuote[]> {
    const now = new Date().toISOString()
    const results: MarketQuote[] = []

    for (const sym of symbols) {
      const rand = this.seedRand(this.hashCode(sym.symbol))
      const basePrice = this.defaultPrice(sym.symbol)
      const changePct = (rand() - 0.5) * 0.02 // ±1%
      const newPrice = basePrice * (1 + changePct)
      const volume = Math.floor(rand() * 10_000_000) + 500_000

      results.push({
        id: uuid(),
        asset_id: '', // filled by caller
        symbol: sym.symbol,
        market: sym.market,
        price: Math.round(newPrice * 100) / 100,
        change_pct: Math.round(changePct * 10000) / 100,
        volume,
        turnover: Math.round(newPrice * volume * 100) / 100,
        quote_time: now,
        source: 'simulated',
      })
    }

    return results
  }

  async getKline(symbol: AssetIdentifier, period: KlinePeriod, from?: string, to?: string): Promise<KlineBar[]> {
    const rand = this.seedRand(this.hashCode(symbol.symbol))
    const basePrice = this.defaultPrice(symbol.symbol)
    const days = period === '1d' ? 120 : period === '1w' ? 52 : 12
    const sigma = 0.25
    const mu = 0.08 / 252
    const dt = 1 / 252

    const bars: KlineBar[] = []
    let price = basePrice * 0.85

    for (let i = 0; i < days; i++) {
      const z = Math.sqrt(-2 * Math.log(Math.max(rand(), 0.001))) * Math.cos(2 * Math.PI * rand())
      price = price * Math.exp((mu - 0.5 * sigma * sigma) * dt + sigma * Math.sqrt(dt) * z)
      price = Math.max(price, basePrice * 0.5)

      const open = price
      const close = price * (1 + (rand() - 0.5) * 0.03)
      const high = Math.max(open, close) * (1 + rand() * 0.015)
      const low = Math.min(open, close) * (1 - rand() * 0.015)

      const d = new Date()
      d.setDate(d.getDate() - (days - i))
      const barTime = d.toISOString().split('T')[0]

      bars.push({
        id: uuid(),
        asset_id: '',
        period,
        open: Math.round(open * 100) / 100,
        high: Math.round(high * 100) / 100,
        low: Math.round(low * 100) / 100,
        close: Math.round(close * 100) / 100,
        volume: Math.floor(rand() * 50_000_000) + 1_000_000,
        bar_time: barTime,
        source: 'simulated',
      })
    }

    return bars
  }

  async healthCheck(): Promise<boolean> {
    return true
  }

  normalizeAssetCode(symbol: string, market: string): string {
    return `${market}.${symbol}`
  }

  private hashCode(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i)
      hash |= 0
    }
    return Math.abs(hash)
  }

  private defaultPrice(symbol: string): number {
    // Quick lookup for known assets from seed
    const prices: Record<string, number> = {
      '300750': 205, '600519': 1620, '00700': 385, '002594': 268,
      '600036': 38.5, '300274': 82, '510300': 3.95, '510500': 6.15,
      '513180': 0.52, '005827': 2.08, '003095': 1.55, '000961': 1.18,
    }
    return prices[symbol] ?? 10.0
  }
}
