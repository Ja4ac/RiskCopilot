import { getDb } from '../db'
import type { InstrumentListing, DataQualityStatus, AssetType, Market } from '../../shared/types/database'
import { getStockListingService } from './stock-listing.service'
import { EastMoneyProvider } from './market-providers/eastmoney-provider'

interface SearchResult {
  listing: InstrumentListing
  quality: DataQualityStatus
}

/**
 * InstrumentSearchService — unified search with normalization, local cache, and online fallback.
 *
 * Query forms supported:
 *   - Exact code: "600519", "300274", "00700"
 *   - Code with market prefix: "SH600519", "SZ300274", "HK00700"
 *   - Name / alias: "贵州茅台", "茅台", "阳光电源"
 *   - Pinyin: "mt", "gyh" (if aliases include pinyin)
 *
 * Search strategy:
 *   1. Normalize query
 *   2. Search local stock_listings (symbol, name, aliases)
 *   3. If no results and query looks like a code, try online provider
 *   4. Return results with data quality metadata
 */
export class InstrumentSearchService {
  private eastMoney = new EastMoneyProvider()

  /**
   * Normalize a raw user query into structured search terms.
   */
  normalizeQuery(raw: string): { symbol?: string; market?: string; name?: string; isExactCode: boolean } {
    const trimmed = raw.trim()

    // Pattern: market prefix + 6-digit code (e.g., SH600519, sz300274)
    const prefixed = trimmed.match(/^(SH|SZ|HK|US|OF)([A-Z0-9.]+)$/i)
    if (prefixed) {
      return {
        symbol: prefixed[2].toUpperCase(),
        market: prefixed[1].toUpperCase(),
        isExactCode: true,
      }
    }

    // Pattern: pure 6-digit code (A-share)
    if (/^\d{6}$/.test(trimmed)) {
      // Infer market: 60/68/51/56 → SH, 00/30/15/16 → SZ
      const market = this.inferMarket(trimmed)
      return { symbol: trimmed, market, isExactCode: true }
    }

    // Pattern: HK stock (5-digit) or US symbol
    if (/^\d{5}$/.test(trimmed) || /^[A-Z]{1,5}$/i.test(trimmed)) {
      return { symbol: trimmed.toUpperCase(), isExactCode: true }
    }

    // Otherwise treat as name search
    return { name: trimmed, isExactCode: false }
  }

  /**
   * Search local cache (stock_listings table) with optional online fallback.
   */
  async search(
    query: string,
    assetType?: string,
    limit = 50,
    offset = 0,
    options?: { allowOnlineFallback?: boolean }
  ): Promise<{ results: SearchResult[]; total: number; fallbackUsed: boolean }> {
    const normalized = this.normalizeQuery(query)
    const db = getDb()
    const now = new Date().toISOString()

    // ── 1. Local cache search ──
    let localResults: InstrumentListing[] = []

    if (normalized.isExactCode && normalized.symbol) {
      // Exact symbol match
      const rows = db.prepare(`
        SELECT symbol, market, name, asset_type, industry, is_active,
               last_quote_price, last_quote_change_pct, last_quote_time, updated_at
        FROM stock_listings
        WHERE is_active = 1 AND symbol = ?
        ${assetType && assetType !== 'all' ? "AND asset_type = ?" : ""}
        ORDER BY symbol ASC
        LIMIT ? OFFSET ?
      `).all(
        normalized.symbol,
        ...(assetType && assetType !== 'all' ? [assetType] : []),
        limit,
        offset
      ) as InstrumentListing[]
      localResults = rows
    } else {
      // Fuzzy name search
      const likeQuery = `%${normalized.name}%`
      const rows = db.prepare(`
        SELECT symbol, market, name, asset_type, industry, is_active,
               last_quote_price, last_quote_change_pct, last_quote_time, updated_at
        FROM stock_listings
        WHERE is_active = 1 AND (name LIKE ? OR symbol LIKE ?)
        ${assetType && assetType !== 'all' ? "AND asset_type = ?" : ""}
        ORDER BY symbol ASC
        LIMIT ? OFFSET ?
      `).all(
        likeQuery,
        likeQuery,
        ...(assetType && assetType !== 'all' ? [assetType] : []),
        limit,
        offset
      ) as InstrumentListing[]
      localResults = rows
    }

    // Count total
    let totalSql = `SELECT COUNT(*) as c FROM stock_listings WHERE is_active = 1`
    const totalParams: (string | number)[] = []

    if (normalized.isExactCode && normalized.symbol) {
      totalSql += ` AND symbol = ?`
      totalParams.push(normalized.symbol)
    } else {
      totalSql += ` AND (name LIKE ? OR symbol LIKE ?)`
      totalParams.push(`%${normalized.name}%`, `%${normalized.name}%`)
    }
    if (assetType && assetType !== 'all') {
      totalSql += ` AND asset_type = ?`
      totalParams.push(assetType)
    }
    const totalRow = db.prepare(totalSql).get(...totalParams) as { c: number }
    const total = totalRow.c

    let fallbackUsed = false

    // ── 2. Online fallback for exact code with no local results ──
    if (localResults.length === 0 && normalized.isExactCode && options?.allowOnlineFallback !== false) {
      fallbackUsed = true
      try {
        const online = await this.searchOnline(normalized.symbol!, normalized.market)
        if (online) {
          // Insert into local cache for future searches
          this.upsertListing(online)
          localResults = [online]
        }
      } catch (e: any) {
        console.error(`[InstrumentSearch] Online search failed for ${normalized.symbol}:`, e.message)
      }
    }

    // Build results with quality metadata
    const results: SearchResult[] = localResults.map((listing) => ({
      listing,
      quality: this.buildQuality(listing, now),
    }))

    return { results, total, fallbackUsed }
  }

  /**
   * Get a single instrument by symbol + market.
   */
  getDetail(symbol: string, market: string): SearchResult | null {
    const db = getDb()
    const now = new Date().toISOString()

    const row = db.prepare(`
      SELECT symbol, market, name, asset_type, industry, is_active,
             last_quote_price, last_quote_change_pct, last_quote_time, updated_at
      FROM stock_listings
      WHERE is_active = 1 AND symbol = ? AND market = ?
    `).get(symbol, market) as InstrumentListing | undefined

    if (!row) return null

    return {
      listing: row,
      quality: this.buildQuality(row, now),
    }
  }

  // ---- Private helpers ----

  private inferMarket(symbol: string): string {
    if (/^(60|68|51|56)/.test(symbol)) return 'SH'
    if (/^(00|30|15|16)/.test(symbol)) return 'SZ'
    // 6-digit codes not matching stock/ETF prefixes are likely off-exchange funds
    if (/^\d{6}$/.test(symbol)) return 'OF'
    return 'SZ'
  }

  private buildQuality(listing: InstrumentListing, now: string): DataQualityStatus {
    const quoteTime = listing.last_quote_time
      ? new Date(listing.last_quote_time).getTime()
      : 0
    const nowMs = new Date(now).getTime()
    const stalenessMs = quoteTime > 0 ? nowMs - quoteTime : Infinity

    let confidence: 'high' | 'medium' | 'low'
    if (stalenessMs < 60_000) confidence = 'high'
    else if (stalenessMs < 300_000) confidence = 'medium'
    else confidence = 'low'

    return {
      source: 'local_cache',
      source_time: listing.last_quote_time ?? listing.updated_at ?? now,
      staleness_ms: stalenessMs,
      confidence,
      error_message: null,
    }
  }

  private async searchOnline(symbol: string, market?: string): Promise<InstrumentListing | null> {
    try {
      // Use EastMoney single-symbol API for A-shares
      const secid = market === 'SH' ? `1.${symbol}` : `0.${symbol}`
      const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f170,f20,f128,f136`
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      })
      if (!resp.ok) return null
      const json = (await resp.json()) as { data?: Record<string, unknown> }
      const d = json.data
      if (!d) return null

      const name = String(d.f58 || '')
      if (!name) return null

      const isEtf = /^5[0-6]|^15|^16/.test(symbol) || /ETF/i.test(name)
      const assetType: AssetType = isEtf ? 'etf' : 'stock'

      const price = Number(d.f43) || 0
      const prevClose = Number(d.f60) || price
      const changePct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0

      return {
        symbol,
        market: (market || this.inferMarket(symbol)) as Market,
        name,
        asset_type: assetType,
        industry: (d.f128 as string) || null,
        aliases: null,
        is_active: true,
        last_quote_price: price > 0 ? price : null,
        last_quote_change_pct: changePct !== 0 ? changePct : null,
        last_quote_time: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    } catch {
      return null
    }
  }

  private upsertListing(listing: InstrumentListing): void {
    const db = getDb()
    db.prepare(`
      INSERT OR REPLACE INTO stock_listings
      (symbol, market, name, asset_type, industry, is_active, last_quote_price, last_quote_change_pct, last_quote_time, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      listing.symbol,
      listing.market,
      listing.name,
      listing.asset_type,
      listing.industry,
      listing.is_active ? 1 : 0,
      listing.last_quote_price,
      listing.last_quote_change_pct,
      listing.last_quote_time,
      listing.updated_at
    )
  }
}

// Singleton
let service: InstrumentSearchService | null = null
export function getInstrumentSearchService(): InstrumentSearchService {
  if (!service) service = new InstrumentSearchService()
  return service
}
