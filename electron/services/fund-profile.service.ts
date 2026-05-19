import { getDb } from '../db'
import type { FundProfile, FundNav, FundHolding, FundPerformance, Market } from '../../shared/types/database'

/**
 * FundProfileService — manages fund-specific data: NAV, holdings, performance, profile.
 *
 * Data sources:
 *   - Local SQLite cache (fund_profiles, fund_navs, fund_holdings, fund_performances tables)
 *   - Online fallback: EastMoney fund API (to be implemented as data-proxy layer)
 *
 * Phase-1 scope: local cache + basic profile construction from stock_listings.
 */
export class FundProfileService {
  /**
   * Get or create a basic fund profile from stock_listings + defaults.
   */
  getProfile(symbol: string, market: string): FundProfile | null {
    const db = getDb()

    // Try local cache first
    const cached = db.prepare(`
      SELECT * FROM fund_profiles WHERE symbol = ? AND market = ?
    `).get(symbol, market) as FundProfile | undefined

    if (cached) return cached

    // Fallback: build from stock_listings
    const listing = db.prepare(`
      SELECT name, asset_type, industry FROM stock_listings
      WHERE symbol = ? AND market = ? AND is_active = 1
    `).get(symbol, market) as { name: string; asset_type: string; industry: string | null } | undefined

    if (!listing || listing.asset_type !== 'fund') return null

    const profile: FundProfile = {
      symbol,
      market: market as Market,
      name: listing.name,
      fund_type: listing.industry || '混合型',
      manager: null,
      management_company: null,
      inception_date: null,
      aum: null,
      expense_ratio: null,
      purchase_status: null,
      redemption_status: null,
      benchmark: null,
      tracking_index: null,
      updated_at: new Date().toISOString(),
    }

    return profile
  }

  /**
   * Get the latest NAV for a fund.
   */
  getLatestNav(symbol: string, market: string): FundNav | null {
    const db = getDb()
    const row = db.prepare(`
      SELECT * FROM fund_navs
      WHERE symbol = ? AND market = ?
      ORDER BY nav_date DESC
      LIMIT 1
    `).get(symbol, market) as FundNav | undefined

    return row || null
  }

  /**
   * Get fund holdings (top N).
   */
  getHoldings(symbol: string, market: string, limit = 10): FundHolding[] {
    const db = getDb()
    return db.prepare(`
      SELECT * FROM fund_holdings
      WHERE symbol = ? AND market = ?
      ORDER BY weight_pct DESC
      LIMIT ?
    `).all(symbol, market, limit) as FundHolding[]
  }

  /**
   * Get fund performance across periods.
   */
  getPerformance(symbol: string, market: string): FundPerformance[] {
    const db = getDb()
    return db.prepare(`
      SELECT * FROM fund_performances
      WHERE symbol = ? AND market = ?
      ORDER BY FIELD(period, '1m', '3m', '6m', '1y', '3y', '5y', 'ytd')
    `).all(symbol, market) as FundPerformance[]
  }

  /**
   * Save a fund profile to cache.
   */
  saveProfile(profile: FundProfile): void {
    const db = getDb()
    db.prepare(`
      INSERT OR REPLACE INTO fund_profiles
      (symbol, market, name, fund_type, manager, management_company, inception_date,
       aum, expense_ratio, purchase_status, redemption_status, benchmark, tracking_index, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      profile.symbol, profile.market, profile.name, profile.fund_type,
      profile.manager, profile.management_company, profile.inception_date,
      profile.aum, profile.expense_ratio, profile.purchase_status,
      profile.redemption_status, profile.benchmark, profile.tracking_index,
      profile.updated_at
    )
  }

  /**
   * Save a NAV record.
   */
  saveNav(nav: FundNav): void {
    const db = getDb()
    db.prepare(`
      INSERT OR REPLACE INTO fund_navs
      (symbol, market, nav, accumulated_nav, daily_return_pct, source, nav_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      nav.symbol, nav.market, nav.nav, nav.accumulated_nav,
      nav.daily_return_pct, nav.source, nav.nav_date
    )
  }
}

// Singleton
let service: FundProfileService | null = null
export function getFundProfileService(): FundProfileService {
  if (!service) service = new FundProfileService()
  return service
}
