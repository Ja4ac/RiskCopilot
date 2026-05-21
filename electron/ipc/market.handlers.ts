import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { IpcGetKlinePayload, IpcGetIndicatorsPayload, IpcSaveMarketSourcePayload } from '../../shared/types/ipc'
import type { MarketProviderStatus, DataSourceConfig, Market, MarketQuote } from '../../shared/types/database'
import { MarketService } from '../services/market.service'
import { getMarketSyncEngine } from '../services/market-sync'
import { getActiveMarketProvider, getMarketProviderRegistry, refreshRegistry } from '../services/market-providers/registry'
import { HttpMarketProvider } from '../services/market-providers/http-provider'
import { createIpcHandler } from './create-handler'
import { getStockListingService } from '../services/stock-listing.service'
import { getInstrumentSearchService } from '../services/instrument-search.service'
import { getWatchlistService } from '../services/watchlist.service'
import { KlineService } from '../services/kline.service'
import { getDb } from '../db'
import { v4 as uuid } from 'uuid'

const marketService = new MarketService()
const klineService = new KlineService()

export function registerMarketHandlers(): void {
  // ── Quotes ──
  createIpcHandler(IPC_CHANNELS.MARKET_GET_QUOTES, async (_event, assetIds?: string[]) => {
    let quotes = marketService.getQuotes(assetIds)
    const db = getDb()
    let assets: { id: string; symbol: string; market: string }[]

    if (assetIds && assetIds.length > 0) {
      const placeholders = assetIds.map(() => '?').join(',')
      assets = db.prepare(`SELECT id, symbol, market FROM assets WHERE id IN (${placeholders})`).all(...assetIds) as any[]
    } else {
      assets = db.prepare('SELECT id, symbol, market FROM assets').all() as any[]
    }

    // Also consider stale quotes (>5 min old) as missing — refresh them
    const staleThreshold = Date.now() - 5 * 60 * 1000
    const freshAssetIds = new Set(
      quotes
        .filter((q) => new Date(q.quote_time).getTime() > staleThreshold)
        .map((q) => q.asset_id)
    )
    const quoteAssetIds = new Set(quotes.map((q) => q.asset_id))
    const missingAssets = assets.filter((a) => !freshAssetIds.has(a.id))

    if (missingAssets.length > 0) {
      const identifiers = missingAssets.map((a) => ({ symbol: a.symbol, market: a.market as Market }))
      let liveQuotes: MarketQuote[] = []
      const providers = [getActiveMarketProvider(), ...Array.from(getMarketProviderRegistry().values()).filter((p) => p.id !== getActiveMarketProvider().id)]

      let anyProviderResponded = false
      for (const provider of providers) {
        try {
          const result = await provider.getQuotes(identifiers)
          if (Array.isArray(result)) {
            anyProviderResponded = true
            if (result.length > 0) {
              liveQuotes = result
              break
            }
          }
        } catch { /* try next provider */ }
      }

      if (!anyProviderResponded) {
        throw new Error('All providers failed to fetch live quotes')
      }

      const assetMap = new Map<string, { id: string; symbol: string; market: string }>()
      const symbolMap = new Map<string, { id: string; symbol: string; market: string }>()
      for (const a of missingAssets) {
        assetMap.set(`${a.symbol}:${a.market}`, a)
        symbolMap.set(a.symbol, a)
      }

      const insertQuote = db.prepare(`
        INSERT INTO market_quotes (id, asset_id, price, change_pct, volume, turnover, quote_time, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      // Clean up old stale quotes for refreshed assets
      const refreshedAssetIds = new Set<string>()
      const listingSvc = getStockListingService()
      for (const quote of liveQuotes) {
        const key = `${quote.symbol}:${quote.market}`
        let asset = assetMap.get(key)
        if (!asset && quote.market === 'OF') asset = symbolMap.get(quote.symbol)
        if (!asset || quote.price == null) continue
        // Normalize price: some providers return 分 instead of 元 (e.g., 981 → 9.81).
        // US/HK stocks have their own currency — skip normalization.
        let price = quote.price
        if (quote.market !== 'US' && quote.market !== 'HK' && price > 100) {
          const inYuan = price / 100
          if (inYuan > 0.5 && inYuan < 100) {
            console.warn(`[MARKET_GET_QUOTES] Normalized ${quote.symbol} price from ${price} to ${inYuan}`)
            price = inYuan
          }
        }
        refreshedAssetIds.add(asset.id)
        insertQuote.run(uuid(), asset.id, price, quote.change_pct, quote.volume, quote.turnover, quote.quote_time, quote.source)
        listingSvc.updateQuote(asset.symbol, asset.market, price, quote.change_pct ?? 0)
      }
      // Remove old stale quotes for refreshed assets (keep only latest)
      for (const assetId of refreshedAssetIds) {
        db.prepare(`DELETE FROM market_quotes WHERE asset_id = ? AND id NOT IN (SELECT id FROM market_quotes WHERE asset_id = ? ORDER BY quote_time DESC LIMIT 1)`).run(assetId, assetId)
      }
      quotes = marketService.getQuotes(assetIds)
    }
    return quotes
  })

  // ── K-line ──
  createIpcHandler(IPC_CHANNELS.MARKET_GET_KLINE, async (_event, payload: IpcGetKlinePayload & { force?: boolean }) => {
    return klineService.fetchKline(payload.asset_id, payload.period, payload.force, payload.from, payload.to)
  })

  // ── Indicators ──
  createIpcHandler(IPC_CHANNELS.MARKET_GET_INDICATORS, async (_event, payload: IpcGetIndicatorsPayload) => {
    return marketService.getIndicators(payload.asset_id, payload.period, payload.types)
  })

  // ── Market sync ──
  createIpcHandler(IPC_CHANNELS.MARKET_SYNC_QUOTES, async () => {
    const engine = getMarketSyncEngine()
    return engine.syncAllForce()
  })

  // ── Single asset force refresh: clear all cached data for one asset, then re-fetch ──
  createIpcHandler(IPC_CHANNELS.MARKET_FORCE_REFRESH_ASSET, async (_event, payload: { assetId: string; symbol: string; market: string; assetType: string }) => {
    const db = getDb()
    const { assetId, symbol, market, assetType } = payload

    // Clear cached data for this asset
    db.prepare(`DELETE FROM kline_bars WHERE asset_id = ?`).run(assetId)
    db.prepare(`DELETE FROM market_quotes WHERE asset_id = ?`).run(assetId)

    // Re-fetch based on type
    const engine = getMarketSyncEngine()
    if (assetType === 'fund') {
      // For funds: refresh NAV history and rewrite quote
      const { fetchFundNavFromProxy } = await import('../services/data-proxy')
      const navData = await fetchFundNavFromProxy(symbol)
      if (navData && navData.nav > 0) {
        db.prepare(`INSERT INTO market_quotes (id, asset_id, price, change_pct, volume, turnover, quote_time, source) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`)
          .run(uuid(), assetId, navData.nav, null, new Date().toISOString(), 'python-proxy-nav')
      }
      // Also re-fetch NAV history for chart
      try {
        const { fetchFundNavHistoryFromProxy } = await import('../services/data-proxy')
        await fetchFundNavHistoryFromProxy(symbol)
          .then((result) => {
            const insertNav = db.prepare(`INSERT OR IGNORE INTO fund_navs (symbol, market, nav, accumulated_nav, daily_return_pct, source, nav_date) VALUES (?, ?, ?, NULL, NULL, 'akshare', ?)`)
            for (const item of result.history) {
              insertNav.run(symbol, 'OF', item.nav, item.nav_date)
            }
            console.log(`[forceRefreshAsset] Synced ${result.count} NAV records for ${symbol}`)
          })
      } catch {}
    } else {
      // For stocks/ETFs: re-fetch quote and K-line
      const provider = getActiveMarketProvider()
      try {
        const quotes = await provider.getQuotes([{ symbol, market: market as Market }])
        if (quotes.length > 0 && quotes[0].price > 0) {
          db.prepare(`INSERT INTO market_quotes (id, asset_id, price, change_pct, volume, turnover, quote_time, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(uuid(), assetId, quotes[0].price, quotes[0].change_pct, quotes[0].volume, quotes[0].turnover, quotes[0].quote_time, quotes[0].source)
        }
      } catch (e: any) {
        console.warn(`[forceRefreshAsset] Quote fetch failed for ${symbol}: ${e.message}`)
      }
      // Re-fetch K-line
      try {
        const { KlineService } = await import('../services/kline.service')
        const klineService = new KlineService()
        const klinesResult = await klineService.fetchKline(assetId, '1d', true)
        if (klinesResult.bars.length > 0) {
          console.log(`[forceRefreshAsset] Fetched ${klinesResult.bars.length} K-line bars for ${symbol}`)
        }
      } catch (e: any) {
        console.warn(`[forceRefreshAsset] K-line fetch failed for ${symbol}: ${e.message}`)
      }
    }

    return { refreshed: true }
  })

  // ── Source status ──
  createIpcHandler(IPC_CHANNELS.MARKET_GET_SOURCE_STATUS, async () => {
    const provider = getActiveMarketProvider()
    const healthy = await provider.healthCheck()
    const status: MarketProviderStatus = {
      provider: provider.provider, name: provider.name, is_enabled: true,
      last_health_at: new Date().toISOString(),
      last_health_status: healthy ? 'ok' : 'error',
      last_error_message: healthy ? null : '健康检查失败',
    }
    return status
  })

  // ── Market Data Source CRUD ──
  createIpcHandler(IPC_CHANNELS.MARKET_LIST_SOURCES, async () => {
    const db = getDb()
    const dbSources = db.prepare(`
      SELECT id, source_type, provider, name, base_url, is_enabled,
             last_health_at, last_health_status, last_error_message, created_at
      FROM data_sources WHERE source_type = 'market' ORDER BY created_at ASC
    `).all() as Omit<DataSourceConfig, 'api_key_encrypted' | 'config_json' | 'updated_at'>[]

    const builtIn = [
      { id: 'sina-free', source_type: 'market' as const, provider: 'sina', name: '新浪免费行情', base_url: 'https://hq.sinajs.cn', is_enabled: true, last_health_at: null, last_health_status: null, last_error_message: null, created_at: new Date().toISOString() },
      { id: 'tencent-free', source_type: 'market' as const, provider: 'tencent', name: '腾讯免费行情', base_url: 'https://qt.gtimg.cn', is_enabled: true, last_health_at: null, last_health_status: null, last_error_message: null, created_at: new Date().toISOString() },
      { id: 'eastmoney-free', source_type: 'market' as const, provider: 'eastmoney', name: '东方财富免费行情', base_url: 'https://push2.eastmoney.com', is_enabled: true, last_health_at: null, last_health_status: null, last_error_message: null, created_at: new Date().toISOString() },
    ]
    const dbIds = new Set(dbSources.map((s) => s.id))
    const sources = [...builtIn.filter((b) => !dbIds.has(b.id)), ...dbSources]
    const activeIdRow = db.prepare("SELECT value FROM app_settings WHERE key = 'market_provider_id'").get() as { value: string } | undefined
    return { sources, activeId: activeIdRow?.value ?? 'sina-free' }
  })

  createIpcHandler(IPC_CHANNELS.MARKET_SAVE_SOURCE, async (_event, payload: IpcSaveMarketSourcePayload) => {
    const db = getDb()
    const now = new Date().toISOString()
    if (payload.id) {
      db.prepare(`UPDATE data_sources SET name = ?, base_url = ?, is_enabled = ?, updated_at = ? WHERE id = ? AND source_type = 'market'`)
        .run(payload.name, payload.base_url, payload.is_enabled !== false ? 1 : 0, now, payload.id)
      refreshRegistry()
      return { id: payload.id }
    }
    const id = `market-${Date.now()}`
    db.prepare(`INSERT INTO data_sources (id, source_type, provider, name, base_url, is_enabled, created_at, updated_at) VALUES (?, 'market', 'http', ?, ?, ?, ?, ?)`)
      .run(id, payload.name, payload.base_url, payload.is_enabled !== false ? 1 : 0, now, now)
    refreshRegistry()
    return { id }
  })

  createIpcHandler(IPC_CHANNELS.MARKET_DELETE_SOURCE, async (_event, id: string) => {
    const db = getDb()
    db.prepare("DELETE FROM data_sources WHERE id = ? AND source_type = 'market'").run(id)
    refreshRegistry()
    return null
  })

  createIpcHandler(IPC_CHANNELS.MARKET_SET_ACTIVE_SOURCE, async (_event, id: string) => {
    const db = getDb()
    db.prepare(`INSERT INTO app_settings (key, value) VALUES ('market_provider_id', ?) ON CONFLICT(key) DO UPDATE SET value = ?`).run(id, id)
    refreshRegistry()
    return null
  })

  // ── Stock Listings ──
  createIpcHandler(IPC_CHANNELS.LISTING_GET, async (_event, payload: { asset_type?: string; limit?: number; offset?: number }) => {
    const svc = getStockListingService()
    return svc.getListingsByType(payload.asset_type, payload.limit || 50, payload.offset || 0)
  })

  createIpcHandler(IPC_CHANNELS.LISTING_SEARCH, async (_event, payload: { query: string; asset_type?: string; limit?: number; offset?: number }) => {
    const svc = getStockListingService()
    return svc.searchListings(payload.query, payload.asset_type, payload.limit || 50, payload.offset || 0)
  })

  createIpcHandler(IPC_CHANNELS.LISTING_REFRESH, async () => {
    const svc = getStockListingService()
    return svc.refreshListings()
  })

  createIpcHandler(IPC_CHANNELS.LISTING_COUNT, async (_event, assetType?: string) => {
    const db = getDb()
    let sql = 'SELECT COUNT(*) as c FROM stock_listings WHERE is_active = 1'
    const params: string[] = []
    if (assetType && assetType !== 'all') { sql += ' AND asset_type = ?'; params.push(assetType) }
    const row = db.prepare(sql).get(...params) as { c: number }
    return row.c
  })

  createIpcHandler(IPC_CHANNELS.LISTING_SYNC_QUOTES, async (_event, limit?: number) => {
    const engine = getMarketSyncEngine()
    return engine.syncListingQuotes(limit)
  })

  // ── Instrument Master Data ──
  createIpcHandler(IPC_CHANNELS.INSTRUMENT_SEARCH, async (_event, payload: { query: string; asset_type?: string; limit?: number; offset?: number }) => {
    const svc = getInstrumentSearchService()
    return svc.search(payload.query, payload.asset_type, payload.limit || 50, payload.offset || 0)
  })

  createIpcHandler(IPC_CHANNELS.INSTRUMENT_GET_DETAIL, async (_event, payload: { symbol: string; market: string }) => {
    const svc = getInstrumentSearchService()
    return svc.getDetail(payload.symbol, payload.market)
  })

  // ── Watchlist ──
  createIpcHandler(IPC_CHANNELS.WATCHLIST_LIST, async (_event, assetType?: string) => {
    const svc = getWatchlistService()
    return svc.list(assetType)
  })

  createIpcHandler(IPC_CHANNELS.WATCHLIST_ADD, async (_event, payload: { symbol: string; market: string; name?: string; asset_type?: string; origin?: 'manual' | 'trade'; notes?: string }) => {
    const svc = getWatchlistService()
    return svc.add(payload.symbol, payload.market, payload.name, payload.asset_type, payload.origin || 'manual', payload.notes)
  })

  createIpcHandler(IPC_CHANNELS.WATCHLIST_REMOVE, async (_event, payload: { asset_id: string }) => {
    const svc = getWatchlistService()
    return svc.remove(payload.asset_id)
  })

  createIpcHandler(IPC_CHANNELS.WATCHLIST_GET_DETAIL, async (_event, payload: { asset_id: string }) => {
    const svc = getWatchlistService()
    return svc.getDetail(payload.asset_id)
  })
}
