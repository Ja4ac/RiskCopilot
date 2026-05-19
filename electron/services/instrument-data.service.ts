import { getDb } from '../db'
import type { Asset, MarketQuote, DataQualityStatus, FundProfile, FundNav, FundHolding, FundPerformance } from '../../shared/types/database'
import { getFundProfileService } from './fund-profile.service'

/**
 * InstrumentDataService — unified facade that returns asset-specific data dimensions.
 *
 * Phase-1: delegates to specialized services based on asset_type.
 *   - fund / etf / lof / money_market_fund / qdii → FundProfileService
 *   - stock / index / bond / convertible_bond / reit → basic quote + listing metadata
 *   - cash / other → minimal metadata
 */
export class InstrumentDataService {
  /**
   * Fetch a complete data envelope for an asset.
   */
  getDetail(assetId: string): InstrumentDataEnvelope | null {
    const db = getDb()

    const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId) as Asset | undefined
    if (!asset) return null

    // Latest quote
    const quote = db.prepare(`
      SELECT * FROM market_quotes
      WHERE asset_id = ?
      ORDER BY quote_time DESC
      LIMIT 1
    `).get(assetId) as MarketQuote | undefined

    // Data quality from quote source
    const quality: DataQualityStatus | null = quote
      ? {
          source: quote.source,
          source_time: quote.quote_time,
          staleness_ms: Date.now() - new Date(quote.quote_time).getTime(),
          confidence: 'high',
          error_message: null,
        }
      : null

    // Asset-type-specific dimensions
    const dimensions: InstrumentDimensions = {}

    if (['fund', 'etf', 'lof', 'money_market_fund', 'qdii'].includes(asset.asset_type)) {
      const fundSvc = getFundProfileService()
      dimensions.fund = {
        profile: fundSvc.getProfile(asset.symbol, asset.market),
        latestNav: fundSvc.getLatestNav(asset.symbol, asset.market),
        holdings: fundSvc.getHoldings(asset.symbol, asset.market, 10),
        performance: fundSvc.getPerformance(asset.symbol, asset.market),
      }
    }

    if (['stock', 'index', 'bond', 'convertible_bond', 'reit'].includes(asset.asset_type)) {
      const listing = db.prepare(`
        SELECT industry FROM stock_listings
        WHERE symbol = ? AND market = ? AND is_active = 1
      `).get(asset.symbol, asset.market) as { industry: string | null } | undefined
      dimensions.listing = { industry: listing?.industry ?? null }
    }

    return {
      asset,
      quote: quote ?? null,
      quality,
      dimensions,
    }
  }
}

// ── Types ──

export interface InstrumentDataEnvelope {
  asset: Asset
  quote: MarketQuote | null
  quality: DataQualityStatus | null
  dimensions: InstrumentDimensions
}

export interface InstrumentDimensions {
  fund?: {
    profile: FundProfile | null
    latestNav: FundNav | null
    holdings: FundHolding[]
    performance: FundPerformance[]
  }
  listing?: {
    industry: string | null
  }
}

// Singleton
let service: InstrumentDataService | null = null
export function getInstrumentDataService(): InstrumentDataService {
  if (!service) service = new InstrumentDataService()
  return service
}
