// Market Provider interface — abstract data source for quotes, kline, and health checks

import type { MarketQuote, KlineBar, KlinePeriod, AssetIdentifier } from '../../../shared/types/database'

export interface IMarketProvider {
  /** Unique provider identifier */
  readonly id: string
  readonly provider: string
  readonly name: string

  /** Fetch latest quotes for given symbols */
  getQuotes(symbols: AssetIdentifier[]): Promise<MarketQuote[]>

  /** Fetch kline bars for a single symbol */
  getKline(symbol: AssetIdentifier, period: KlinePeriod, from?: string, to?: string): Promise<KlineBar[]>

  /** Check if the provider is reachable and functioning */
  healthCheck(): Promise<boolean>

  /** Normalize raw asset code to standard format (e.g., 600519 → SH.600519) */
  normalizeAssetCode(symbol: string, market: string): string
}
