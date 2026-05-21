import { getDb } from '../db'
import { v4 as uuid } from 'uuid'
import { getActiveMarketProvider, getMarketProviderRegistry } from './market-providers/registry'
import type { MarketQuote, KlineBar, AssetIdentifier, Asset, Market } from '../../shared/types/database'
import { RiskService } from './risk.service'
import { AlertService } from './alert.service'
import { getStockListingService } from './stock-listing.service'
import { getWatchlistService } from './watchlist.service'
import { fetchFundNavFromProxy, fetchFundNavHistoryFromProxy } from './data-proxy'
import { KlineService } from './kline.service'
import { getPortfolioQueryService } from './portfolio'

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

const MAX_RETRIES = 3
const klineService = new KlineService()

/**
 * Helper: retry an async operation up to MAX_RETRIES times.
 * Returns the result on first success, throws after all retries exhausted.
 */
async function retry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: any
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (e: any) {
      lastErr = e
      if (attempt < MAX_RETRIES) {
        console.warn(`[retry] ${label} attempt ${attempt}/${MAX_RETRIES} failed: ${e.message}. Retrying...`)
        await sleep(2000 * attempt)
      }
    }
  }
  throw new Error(`${label} 连续 ${MAX_RETRIES} 次获取失败: ${lastErr?.message || lastErr}`)
}

/**
 * Market sync engine — local-first, online-assisted.
 * 
 * Auto refresh:
 *   Stocks: every 15s — only today's quote, no K-lines, no history
 *   Funds:  every 60s — only today's NAV, no history
 *   Local-first: skips online request if local data is fresh
 * 
 * "强制刷新" (syncAllForce):
 *   Sequential, 5s gap per asset (both stocks and funds)
 *   3 retries per asset, error reported in result
 *   Writes to local first, then revalues from local
 * 
 * "普通刷新": local DB only, zero online requests
 * 
 * New watchlist/trade: handled by periodic sync + on-demand K-line handler
 */
export class MarketSyncEngine {
  private stockTimer: ReturnType<typeof setInterval> | null = null
  private fundTimer: ReturnType<typeof setInterval> | null = null
  private stockIntervalMs = 15000
  private fundIntervalMs = 60000

  // ── Start / Stop ──────────────────────────────────────────────

  start(): void {
    this.stop()
    this.stockTimer = setInterval(() => this.syncStocks(), this.stockIntervalMs)
    this.fundTimer = setInterval(() => this.syncFunds(), this.fundIntervalMs)
    console.log(`[MarketSync] Stocks every ${this.stockIntervalMs / 1000}s, funds every ${this.fundIntervalMs / 1000}s`)
    this.syncStocks()
    this.syncFunds()
  }

  stop(): void {
    if (this.stockTimer) { clearInterval(this.stockTimer); this.stockTimer = null }
    if (this.fundTimer) { clearInterval(this.fundTimer); this.fundTimer = null }
  }

  // ── Stock auto sync (every 15s, only today's quote, no K-line) ─

  async syncStocks(): Promise<void> {
    const db = getDb()
    const provider = getActiveMarketProvider()
    try {
      const syncAssetIds = getWatchlistService().getSyncAssetIds()
      if (syncAssetIds.length === 0) return

      const placeholders = syncAssetIds.map(() => '?').join(',')
      const assets = db.prepare(`
        SELECT * FROM assets WHERE id IN (${placeholders}) ORDER BY symbol ASC
      `).all(...syncAssetIds) as Asset[]

      const stockAssets = assets.filter((a) => a.asset_type !== 'fund' && a.market !== 'OF')
      if (stockAssets.length === 0) return

      // Local-first: only fetch quotes older than 60s
      const staleThreshold = new Date(Date.now() - 60000).toISOString()
      const freshIds = new Set(
        (db.prepare(`SELECT DISTINCT asset_id FROM market_quotes WHERE quote_time >= ?`).all(staleThreshold) as { asset_id: string }[]).map((r) => r.asset_id)
      )
      const assetsNeedingQuotes = stockAssets.filter((a) => !freshIds.has(a.id))
      if (assetsNeedingQuotes.length === 0) return

      const identifiers: AssetIdentifier[] = assetsNeedingQuotes.map((a) => ({ symbol: a.symbol, market: a.market }))
      const quotes = await this.fetchQuotesFromProviders(identifiers, provider)
      const insertQuote = db.prepare(`
        INSERT INTO market_quotes (id, asset_id, price, change_pct, volume, turnover, quote_time, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const assetMap = new Map(assetsNeedingQuotes.map((a) => [`${a.symbol}:${a.market}`, a]))
      let written = 0
      for (const quote of quotes) {
        const asset = assetMap.get(`${quote.symbol}:${quote.market}`)
        if (!asset) continue
        insertQuote.run(uuid(), asset.id, quote.price, quote.change_pct, quote.volume, quote.turnover, quote.quote_time, quote.source)
        written++
      }
      if (written > 0) console.log(`[MarketSync] Stocks: ${written} quotes`)
      this.revaluePositions(db, stockAssets.map((a) => a.id))
    } catch (error: any) {
      console.error('[MarketSync] Stock sync failed:', error.message)
    }
  }

  // ── Fund auto sync (every 60s, only today's NAV, no history) ───

  async syncFunds(): Promise<void> {
    const db = getDb()
    try {
      const syncAssetIds = getWatchlistService().getSyncAssetIds()
      if (syncAssetIds.length === 0) return

      const placeholders = syncAssetIds.map(() => '?').join(',')
      const assets = db.prepare(`
        SELECT * FROM assets WHERE id IN (${placeholders}) ORDER BY symbol ASC
      `).all(...syncAssetIds) as Asset[]

      const fundAssets = assets.filter((a) => a.market === 'OF' || a.asset_type === 'fund')
      if (fundAssets.length === 0) return

      const today = new Date().toISOString().slice(0, 10)
      const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      const insertQuote = db.prepare(`
        INSERT INTO market_quotes (id, asset_id, price, change_pct, volume, turnover, quote_time, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      let written = 0

      for (const fund of fundAssets) {
        // Check if today's NAV exists locally
        const localNav = db.prepare(`
          SELECT nav, nav_date FROM fund_navs WHERE symbol = ? AND market = ? AND nav_date = ?
        `).get(fund.symbol, fund.market, today) as { nav: number; nav_date: string } | undefined

        let nav: number
        let navDate: string

        if (localNav) {
          // Use local NAV data, skip online fetch
          nav = localNav.nav
          navDate = localNav.nav_date
        } else {
          // Fetch from proxy
          try {
            db.prepare(`DELETE FROM market_quotes WHERE asset_id = ?`).run(fund.id)
            const navData = await fetchFundNavFromProxy(fund.symbol)
            nav = navData.nav
            navDate = navData.nav_date
            db.prepare(`INSERT OR IGNORE INTO fund_navs (symbol, market, nav, accumulated_nav, daily_return_pct, source, nav_date) VALUES (?, ?, ?, NULL, NULL, 'akshare', ?)`)
              .run(fund.symbol, fund.market, nav, navDate)
          } catch (e: any) {
            console.warn(`[MarketSync] Fund ${fund.symbol} NAV fetch failed: ${e.message}`)
            // Fallback: use most recent local NAV (yesterday's or earlier)
            const fallbackNav = db.prepare(`
              SELECT nav, nav_date FROM fund_navs WHERE symbol = ? AND market = ? ORDER BY nav_date DESC LIMIT 1
            `).get(fund.symbol, fund.market) as { nav: number; nav_date: string } | undefined
            if (fallbackNav && fallbackNav.nav > 0) {
              nav = fallbackNav.nav
              navDate = fallbackNav.nav_date
              console.log(`[MarketSync] Fund ${fund.symbol}: using cached NAV=${nav} from ${navDate}`)
            } else {
              continue // no data at all, skip
            }
          }
        }

        // Ensure NAV history exists so change_pct can be computed
        const navCount = (db.prepare(`SELECT COUNT(*) as c FROM fund_navs WHERE symbol=? AND market=?`).get(fund.symbol, fund.market) as { c: number }).c
        if (navCount < 2) {
          // Sync NAV history from proxy (non-blocking, best-effort)
          try {
            const { fetchFundNavHistoryFromProxy } = await import('./data-proxy')
            const historyResult = await fetchFundNavHistoryFromProxy(fund.symbol)
            const insertNav = db.prepare(`INSERT OR IGNORE INTO fund_navs (symbol, market, nav, accumulated_nav, daily_return_pct, source, nav_date) VALUES (?, ?, ?, NULL, NULL, 'akshare', ?)`)
            for (const item of historyResult.history) {
              insertNav.run(fund.symbol, fund.market, item.nav, item.nav_date)
            }
            console.log(`[MarketSync] Synced ${historyResult.count} NAV records for ${fund.symbol}`)
          } catch (e: any) {
            console.warn(`[MarketSync] NAV history sync failed for ${fund.symbol}: ${e.message}`)
          }
        }

        // Compute change_pct: compare current NAV vs the previous NAV (strictly before navDate)
        const prevNav = db.prepare(`SELECT nav FROM fund_navs WHERE symbol=? AND market=? AND nav_date<? ORDER BY nav_date DESC LIMIT 1`)
          .get(fund.symbol, fund.market, navDate) as { nav: number } | undefined
        const changePct = prevNav?.nav ? Math.round(((nav - prevNav.nav) / prevNav.nav) * 10000) / 100 : null

        // Write to market_quotes (always, even when using local NAV)
        db.prepare(`DELETE FROM market_quotes WHERE asset_id = ?`).run(fund.id)
        insertQuote.run(uuid(), fund.id, nav, changePct, null, null, new Date().toISOString(), 'python-proxy-nav')
        written++

        if (!localNav) {
          console.log(`[MarketSync] Fund ${fund.symbol}: NAV=${nav}, date=${navDate}`)
        }
      }

      if (written > 0) {
        console.log(`[MarketSync] Funds: ${written} NAV quotes written (from ${fundAssets.length} funds)`)
        this.revaluePositions(db, fundAssets.map((f) => f.id))
      }
    } catch (error: any) {
      console.error('[MarketSync] Fund sync failed:', error.message)
    }
  }

  // ── Force sync (rate-limited, 3-retry, missing-date re-request) ─

  async syncAllForce(): Promise<{
    stockCount: number; fundCount: number; quotesWritten: number; klinesWritten: number; positionsUpdated: number
    errors: string[]
  }> {
    const db = getDb()
    const provider = getActiveMarketProvider()
    const syncAssetIds = getWatchlistService().getSyncAssetIds()
    const errors: string[] = []

    if (syncAssetIds.length === 0) return { stockCount: 0, fundCount: 0, quotesWritten: 0, klinesWritten: 0, positionsUpdated: 0, errors }

    // Clear all cached market data (keep assets, trades, positions intact)
    db.prepare(`DELETE FROM kline_bars`).run()
    db.prepare(`DELETE FROM market_quotes`).run()
    console.log(`[syncAllForce] Cleared all cached K-line and quote data`)

    const placeholders = syncAssetIds.map(() => '?').join(',')
    const assets = db.prepare(`
      SELECT * FROM assets WHERE id IN (${placeholders}) ORDER BY symbol ASC
    `).all(...syncAssetIds) as Asset[]

    const stockAssets = assets.filter((a) => a.asset_type !== 'fund' && a.market !== 'OF')
    const fundAssets = assets.filter((a) => a.market === 'OF' || a.asset_type === 'fund')

    let quotesWritten = 0
    let klinesWritten = 0
    const insertQuote = db.prepare(`INSERT INTO market_quotes (id, asset_id, price, change_pct, volume, turnover, quote_time, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)

    // ── Stocks: 5s gap, 3-retry per asset ──
    for (let i = 0; i < stockAssets.length; i++) {
      const asset = stockAssets[i]
      const label = `Stock ${i + 1}/${stockAssets.length}: ${asset.symbol}`
      console.log(`[MarketSync:Force] ${label}`)

      // Quote with retry
      try {
        await retry(`${label} quote`, async () => {
          const quotes = await this.fetchQuotesFromProviders([{ symbol: asset.symbol, market: asset.market }], provider)
          if (quotes.length === 0) throw new Error('No quote data returned')
          for (const quote of quotes) {
            insertQuote.run(uuid(), asset.id, quote.price, quote.change_pct, quote.volume, quote.turnover, quote.quote_time, quote.source)
            quotesWritten++
          }
        })
      } catch (e: any) {
        const msg = `${label} 报价获取失败: ${e.message}`
        console.error(`[MarketSync:Force] ${msg}`)
        errors.push(msg)
      }

      // K-line with retry (delegated to KlineService)
      try {
        const barCount = await klineService.syncKlineForAsset(asset.symbol, asset.market, asset.id, '1d', 365, '')
        klinesWritten += barCount
        console.log(`[MarketSync:Force] ${label}: ${barCount} K-line bars`)
      } catch (e: any) {
        const msg = `${label} K线获取失败: ${e.message}`
        console.error(`[MarketSync:Force] ${msg}`)
        errors.push(msg)
      }

      if (i < stockAssets.length - 1) await sleep(5000)
    }

    // ── Funds: 5s gap, 3-retry per asset ──
    for (let i = 0; i < fundAssets.length; i++) {
      const fund = fundAssets[i]
      const label = `Fund ${i + 1}/${fundAssets.length}: ${fund.symbol}`
      console.log(`[MarketSync:Force] ${label}`)

      db.prepare(`DELETE FROM market_quotes WHERE asset_id = ?`).run(fund.id)

      try {
        await retry(label, async () => {
          const navData = await fetchFundNavFromProxy(fund.symbol)

          // Write latest NAV to local
          db.prepare(`INSERT OR IGNORE INTO fund_navs (symbol, market, nav, accumulated_nav, daily_return_pct, source, nav_date) VALUES (?, ?, ?, NULL, NULL, 'akshare', ?)`)
            .run(fund.symbol, fund.market, navData.nav, navData.nav_date)

          // If history < 30 records, fetch 90-day history
          const historyCount = (db.prepare(`SELECT COUNT(*) as cnt FROM fund_navs WHERE symbol=? AND market=?`).get(fund.symbol, fund.market) as { cnt: number }).cnt
          if (historyCount < 30) {
            try {
              const endDate = navData.nav_date
              const startObj = new Date(navData.nav_date)
              startObj.setDate(startObj.getDate() - 90)
              const historyResult = await fetchFundNavHistoryFromProxy(fund.symbol, startObj.toISOString().slice(0, 10), endDate)
              if (historyResult.history?.length > 0) {
                const insertNav = db.prepare(`INSERT OR IGNORE INTO fund_navs (symbol, market, nav, accumulated_nav, daily_return_pct, source, nav_date) VALUES (?, ?, ?, NULL, NULL, 'akshare', ?)`)
                for (const item of historyResult.history) insertNav.run(fund.symbol, fund.market, item.nav, item.nav_date)
                console.log(`[MarketSync:Force] ${label}: ${historyResult.history.length} history NAV records`)
              }
            } catch (histErr: any) {
              console.warn(`[MarketSync:Force] ${label} NAV history: ${histErr.message}`)
            }
          }

          // Compute change_pct from local
          const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
          const yesterdayRow = db.prepare(`SELECT nav FROM fund_navs WHERE symbol=? AND market=? AND nav_date<=? ORDER BY nav_date DESC LIMIT 1`)
            .get(fund.symbol, fund.market, yesterdayStr) as { nav: number } | undefined
          const changePct = yesterdayRow?.nav ? Math.round(((navData.nav - yesterdayRow.nav) / yesterdayRow.nav) * 10000) / 100 : null

          insertQuote.run(uuid(), fund.id, navData.nav, changePct, null, null, new Date().toISOString(), 'python-proxy-nav')
          quotesWritten++
        })
      } catch (e: any) {
        const msg = `${label} 净值获取失败: ${e.message}`
        console.error(`[MarketSync:Force] ${msg}`)
        errors.push(msg)
      }

      if (i < fundAssets.length - 1) await sleep(5000)
    }

    const allAssetIds = assets.map((a) => a.id)
    const positionsUpdated = this.revaluePositions(db, allAssetIds)
    this.postSyncTasks(db)

    return { stockCount: stockAssets.length, fundCount: fundAssets.length, quotesWritten, klinesWritten, positionsUpdated, errors }
  }

  // ── Helpers ────────────────────────────────────────────────────

  /** Normalize price from providers. Different markets/APIs use different units:
   *   - A-shares: 元 (CNY), but some providers return 分 (÷100)
   *   - US stocks: USD, always in dollars — never normalize
   *   - HK stocks: HKD, some providers return integers in 厘 (÷1000) */
  private normalizeQuotePrice(quote: MarketQuote): number {
    let price = quote.price
    if (price <= 0) return price

    const mkt = quote.market
    // US stocks — never normalize, prices > 100 are normal
    if (mkt === 'US') return price
    // HK stocks — providers may return integer 厘 units (e.g. 440000 → 440.000 HKD)
    if (mkt === 'HK') {
      if (price > 10000) {
        const inDollars = price / 1000
        console.warn(`[MarketSync] Normalized HK ${quote.symbol} price from ${price} (厘) to ${inDollars}`)
        return Math.round(inDollars * 1000) / 1000
      }
      return price
    }
    // A-shares — some providers return 分 instead of 元
    if (price > 100) {
      const inYuan = price / 100
      if (inYuan > 0.5 && inYuan < 100) {
        console.warn(`[MarketSync] Normalized ${quote.symbol} price from ${price} (分) to ${inYuan} (元)`)
        price = inYuan
      }
    }
    return price
  }

  private async fetchQuotesFromProviders(identifiers: AssetIdentifier[], primaryProvider: ReturnType<typeof getActiveMarketProvider>): Promise<MarketQuote[]> {
    const results = new Map<string, MarketQuote>()
    const providers = [primaryProvider, ...Array.from(getMarketProviderRegistry().values()).filter((p) => p.id !== primaryProvider.id)]
    for (const p of providers) {
      try {
        const result = await p.getQuotes(identifiers)
        if (Array.isArray(result) && result.length > 0) {
          for (const quote of result) {
            if (quote.price != null && quote.price > 0) {
              // Normalize price before storing
              const normalizedPrice = this.normalizeQuotePrice(quote)
              results.set(`${quote.symbol}:${quote.market}`, { ...quote, price: normalizedPrice })
            }
          }
          return Array.from(results.values())
        }
      } catch (e: any) { /* try next */ }
    }
    return Array.from(results.values())
  }

  private revaluePositions(db: ReturnType<typeof getDb>, assetIds: string[]): number {
    if (assetIds.length === 0) return 0
    let updated = 0
    const placeholders = assetIds.map(() => '?').join(',')
    const positions = db.prepare(`
      SELECT p.id, p.asset_id, p.quantity, p.cost_amount FROM positions p
      WHERE p.quantity > 0 AND p.asset_id IN (${placeholders})
    `).all(...assetIds) as { id: string; asset_id: string; quantity: number; cost_amount: number }[]
    for (const pos of positions) {
      const q = db.prepare(`SELECT price FROM market_quotes WHERE asset_id=? ORDER BY quote_time DESC LIMIT 1`).get(pos.asset_id) as { price: number } | undefined
      let price = (q?.price && q.price > 0) ? q.price : 0
      // Normalize price from DB (may have been stored before normalization was added)
      if (price > 100) {
        const inYuan = price / 100
        if (inYuan > 0.5 && inYuan < 100) {
          db.prepare(`UPDATE market_quotes SET price=? WHERE asset_id=? AND price=?`).run(inYuan, pos.asset_id, price)
          price = inYuan
        }
      }
      if (price > 0) {
        const mv = Math.round(pos.quantity * price * 100) / 100
        db.prepare(`UPDATE positions SET market_value=?, unrealized_pnl=?, updated_at=? WHERE id=?`)
          .run(mv, Math.round((mv - pos.cost_amount) * 100) / 100, new Date().toISOString(), pos.id)
        updated++
      }
    }
    return updated
  }

  private postSyncTasks(db: ReturnType<typeof getDb>): void {
    try { getPortfolioQueryService().recordDailyPortfolioValue() } catch (e: any) { console.error('[MarketSync] recordDaily:', e.message) }
    try { new RiskService().saveSnapshot() } catch (e: any) { console.error('[MarketSync] risk snapshot:', e.message) }
    try { new AlertService().evaluateAll() } catch (e: any) { console.error('[MarketSync] alert eval:', e.message) }
  }

  sync(): Promise<{ quotesWritten: number; klinesWritten: number; positionsUpdated: number }> {
    return this.syncAllForce().then((r) => ({ quotesWritten: r.quotesWritten, klinesWritten: r.klinesWritten, positionsUpdated: r.positionsUpdated }))
  }

  private getSettingsInterval(): number { return 30000 }
  syncListingQuotes(_limit?: number): Promise<{ added: number; updated: number }> { return Promise.resolve({ added: 0, updated: 0 }) }
}

// ── Singleton ──
let _engine: MarketSyncEngine | null = null
export function getMarketSyncEngine(): MarketSyncEngine {
  if (!_engine) _engine = new MarketSyncEngine()
  return _engine
}
