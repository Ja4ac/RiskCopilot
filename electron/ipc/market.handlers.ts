import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { IpcGetKlinePayload, IpcGetIndicatorsPayload, IpcSaveMarketSourcePayload } from '../../shared/types/ipc'
import type { MarketProviderStatus, DataSourceConfig, Market, MarketQuote } from '../../shared/types/database'
import { MarketService } from '../services/market.service'
import { getMarketSyncEngine } from '../services/market-sync'
import { fetchKlineFromProxy } from '../services/data-proxy'
import { getActiveMarketProvider, getMarketProviderRegistry, refreshRegistry } from '../services/market-providers/registry'
import { HttpMarketProvider } from '../services/market-providers/http-provider'

import { getStockListingService } from '../services/stock-listing.service'
import { getInstrumentSearchService } from '../services/instrument-search.service'
import { getWatchlistService } from '../services/watchlist.service'
import { getDb } from '../db'
import { v4 as uuid } from 'uuid'

const marketService = new MarketService()

export function registerMarketHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.MARKET_GET_QUOTES, async (_event, assetIds?: string[]) => {
    try {
      let quotes = marketService.getQuotes(assetIds)

      const db = getDb()
      let assets: { id: string; symbol: string; market: string }[]

      if (assetIds && assetIds.length > 0) {
        const placeholders = assetIds.map(() => '?').join(',')
        assets = db.prepare(`SELECT id, symbol, market FROM assets WHERE id IN (${placeholders})`).all(...assetIds) as any[]
      } else {
        assets = db.prepare('SELECT id, symbol, market FROM assets').all() as any[]
      }

      // If some assets have no cached quote, fetch live from provider with fallback
      const quoteAssetIds = new Set(quotes.map((q) => q.asset_id))
      const missingAssets = assets.filter((a) => !quoteAssetIds.has(a.id))

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
                console.log(`[MARKET_GET_QUOTES] Fetched from ${provider.id} (${result.length} quotes)`)
                break
              }
            }
          } catch (e: any) {
            console.warn(`[MARKET_GET_QUOTES] Provider ${provider.id} failed:`, e.message)
          }
        }

        if (!anyProviderResponded) {
          throw new Error(`All providers failed to fetch live quotes`)
        }

        // Build symbol+market -> asset lookup map
        const assetMap = new Map<string, { id: string; symbol: string; market: string }>()
        const symbolMap = new Map<string, { id: string; symbol: string; market: string }>()
        for (const a of missingAssets) {
          assetMap.set(`${a.symbol}:${a.market}`, a)
          symbolMap.set(a.symbol, a)
        }

        // Persist live quotes to DB, matching by symbol+market
        const insertQuote = db.prepare(`
          INSERT INTO market_quotes (id, asset_id, price, change_pct, volume, turnover, quote_time, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)

        const listingSvc = getStockListingService()
        for (const quote of liveQuotes) {
          const key = `${quote.symbol}:${quote.market}`
          let asset = assetMap.get(key)
          if (!asset && quote.market === 'OF') {
            asset = symbolMap.get(quote.symbol)
          }
          if (!asset || quote.price == null) continue
          insertQuote.run(
            uuid(), asset.id, quote.price, quote.change_pct,
            quote.volume, quote.turnover, quote.quote_time, quote.source
          )
          // Also update stock_listings so MarketPage shows latest price
          listingSvc.updateQuote(asset.symbol, asset.market, quote.price, quote.change_pct ?? 0)
        }

        // Re-fetch from DB after persisting
        quotes = marketService.getQuotes(assetIds)
      }

      return { success: true, data: quotes }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.MARKET_GET_KLINE, async (_event, payload: IpcGetKlinePayload & { force?: boolean }) => {
    try {
      // If force mode, delete local K-line data first so on-demand proxy fetch kicks in
      if (payload.force && payload.asset_id) {
        const db = getDb()
        console.log(`[MARKET_GET_KLINE] Force mode: clearing K-line data for ${payload.asset_id}`)
        db.prepare(`DELETE FROM kline_bars WHERE asset_id = ?`).run(payload.asset_id)
      }

      let klines = marketService.getKline(
        payload.asset_id,
        payload.period,
        payload.from,
        payload.to
      )

      // If DB empty and asset_id is provided, try on-demand fetch from proxy
      let proxyFetchAttempted = false
      let proxyFetchError: string | null = null
      if (klines.length === 0) {
        const db = getDb()
        const asset = db.prepare('SELECT symbol, market FROM assets WHERE id = ?').get(payload.asset_id) as { symbol: string; market: string } | undefined
        if (asset && asset.market !== 'OF' && asset.market !== 'OTC') {
          proxyFetchAttempted = true
          try {
            console.log(`[MARKET_GET_KLINE] ${payload.force ? 'Force' : 'DB empty'} for ${asset.symbol}, fetching from proxy...`)
            const bars = await fetchKlineFromProxy(asset.symbol, asset.market, payload.period || '1d', 120, 'qfq')
            if (bars.length > 0) {
              const insertKline = db.prepare(`
                INSERT OR REPLACE INTO kline_bars (id, asset_id, period, open, high, low, close, volume, bar_time, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `)
              for (const bar of bars) {
                const id = `${payload.asset_id}_${bar.bar_time}_${payload.period || '1d'}`
                insertKline.run(id, payload.asset_id, payload.period || '1d', bar.open, bar.high, bar.low, bar.close, bar.volume ?? 0, bar.bar_time, 'akshare')
              }
              console.log(`[MARKET_GET_KLINE] Stored ${bars.length} bars for ${asset.symbol}`)
              klines = marketService.getKline(payload.asset_id, payload.period, payload.from, payload.to)
            }
          } catch (proxyErr: any) {
            proxyFetchError = proxyErr.message
            console.error(`[MARKET_GET_KLINE] Proxy fetch failed for ${payload.asset_id}: ${proxyErr.message}`)
          }
        }
      }
      // If still empty after proxy attempt, return error so frontend shows retry button
      if (klines.length === 0 && proxyFetchAttempted && proxyFetchError) {
        throw new Error(`无法获取K线数据: Python数据源连接失败。${proxyFetchError.slice(0, 100)}`)
      }

      return { success: true, data: klines }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.MARKET_GET_INDICATORS, async (_event, payload: IpcGetIndicatorsPayload) => {
    try {
      const indicators = marketService.getIndicators(
        payload.asset_id,
        payload.period,
        payload.types
      )
      return { success: true, data: indicators }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ---- Market sync ----
  ipcMain.handle(IPC_CHANNELS.MARKET_SYNC_QUOTES, async () => {
    try {
      const engine = getMarketSyncEngine()
      const result = await engine.syncAllForce()
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ---- Source status ----
  ipcMain.handle(IPC_CHANNELS.MARKET_GET_SOURCE_STATUS, async () => {
    try {
      const provider = getActiveMarketProvider()
      const healthy = await provider.healthCheck()
      const status: MarketProviderStatus = {
        provider: provider.provider,
        name: provider.name,
        is_enabled: true,
        last_health_at: new Date().toISOString(),
        last_health_status: healthy ? 'ok' : 'error',
        last_error_message: healthy ? null : '健康检查失败',
      }
      return { success: true, data: status }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ---- Market Data Source CRUD ----
  ipcMain.handle(IPC_CHANNELS.MARKET_LIST_SOURCES, async () => {
    try {
      const db = getDb()
      const dbSources = db.prepare(`
        SELECT id, source_type, provider, name, base_url, is_enabled,
               last_health_at, last_health_status, last_error_message, created_at
        FROM data_sources WHERE source_type = 'market'
        ORDER BY created_at ASC
      `).all() as Omit<DataSourceConfig, 'api_key_encrypted' | 'config_json' | 'updated_at'>[]

      // Built-in real providers only (no mock)
      const builtIn = [
        { id: 'sina-free', source_type: 'market' as const, provider: 'sina', name: '新浪免费行情', base_url: 'https://hq.sinajs.cn', is_enabled: true, last_health_at: null, last_health_status: null, last_error_message: null, created_at: new Date().toISOString() },
        { id: 'tencent-free', source_type: 'market' as const, provider: 'tencent', name: '腾讯免费行情', base_url: 'https://qt.gtimg.cn', is_enabled: true, last_health_at: null, last_health_status: null, last_error_message: null, created_at: new Date().toISOString() },
        { id: 'eastmoney-free', source_type: 'market' as const, provider: 'eastmoney', name: '东方财富免费行情', base_url: 'https://push2.eastmoney.com', is_enabled: true, last_health_at: null, last_health_status: null, last_error_message: null, created_at: new Date().toISOString() },
      ]

      // Merge: built-in first, then custom DB sources (excluding built-in ids if accidentally in DB)
      const dbIds = new Set(dbSources.map((s) => s.id))
      const sources = [...builtIn.filter((b) => !dbIds.has(b.id)), ...dbSources]

      const activeIdRow = db.prepare("SELECT value FROM app_settings WHERE key = 'market_provider_id'").get() as { value: string } | undefined
      const activeId = activeIdRow?.value ?? 'sina-free'

      return { success: true, data: { sources, activeId } }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.MARKET_SAVE_SOURCE, async (_event, payload: IpcSaveMarketSourcePayload) => {
    try {
      const db = getDb()
      const now = new Date().toISOString()

      if (payload.id) {
        db.prepare(`
          UPDATE data_sources
          SET name = ?, base_url = ?, is_enabled = ?, updated_at = ?
          WHERE id = ? AND source_type = 'market'
        `).run(payload.name, payload.base_url, payload.is_enabled !== false ? 1 : 0, now, payload.id)
        refreshRegistry()
        return { success: true, data: { id: payload.id } }
      }

      const id = `market-${Date.now()}`
      db.prepare(`
        INSERT INTO data_sources (id, source_type, provider, name, base_url, is_enabled, created_at, updated_at)
        VALUES (?, 'market', 'http', ?, ?, ?, ?, ?)
      `).run(id, payload.name, payload.base_url, payload.is_enabled !== false ? 1 : 0, now, now)
      refreshRegistry()
      return { success: true, data: { id } }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.MARKET_DELETE_SOURCE, async (_event, id: string) => {
    try {
      const db = getDb()
      db.prepare("DELETE FROM data_sources WHERE id = ? AND source_type = 'market'").run(id)
      refreshRegistry()
      return { success: true, data: null }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.MARKET_SET_ACTIVE_SOURCE, async (_event, id: string) => {
    try {
      const db = getDb()
      db.prepare(`
        INSERT INTO app_settings (key, value) VALUES ('market_provider_id', ?)
        ON CONFLICT(key) DO UPDATE SET value = ?
      `).run(id, id)
      refreshRegistry()
      return { success: true, data: null }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ---- Stock Listings ----
  ipcMain.handle(IPC_CHANNELS.LISTING_GET, async (_event, payload: { asset_type?: string; limit?: number; offset?: number }) => {
    try {
      const svc = getStockListingService()
      const listings = svc.getListingsByType(
        payload.asset_type, // undefined means 'all'
        payload.limit || 50,
        payload.offset || 0
      )
      return { success: true, data: listings }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.LISTING_SEARCH, async (_event, payload: { query: string; asset_type?: string; limit?: number; offset?: number }) => {
    try {
      const svc = getStockListingService()
      const listings = svc.searchListings(
        payload.query,
        payload.asset_type,
        payload.limit || 50,
        payload.offset || 0
      )
      return { success: true, data: listings }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.LISTING_REFRESH, async () => {
    try {
      const svc = getStockListingService()
      const result = await svc.refreshListings()
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.LISTING_COUNT, async (_event, assetType?: string) => {
    try {
      const db = getDb()
      let sql = 'SELECT COUNT(*) as c FROM stock_listings WHERE is_active = 1'
      const params: string[] = []
      if (assetType && assetType !== 'all') {
        sql += ' AND asset_type = ?'
        params.push(assetType)
      }
      const row = db.prepare(sql).get(...params) as { c: number }
      return { success: true, data: row.c }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.LISTING_SYNC_QUOTES, async (_event, limit?: number) => {
    try {
      const engine = getMarketSyncEngine()
      const result = await engine.syncListingQuotes(limit)
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ---- Instrument Master Data (Phase-1) ----
  ipcMain.handle(IPC_CHANNELS.INSTRUMENT_SEARCH, async (_event, payload: { query: string; asset_type?: string; limit?: number; offset?: number }) => {
    try {
      const svc = getInstrumentSearchService()
      const result = await svc.search(
        payload.query,
        payload.asset_type,
        payload.limit || 50,
        payload.offset || 0
      )
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.INSTRUMENT_GET_DETAIL, async (_event, payload: { symbol: string; market: string }) => {
    try {
      const svc = getInstrumentSearchService()
      const result = svc.getDetail(payload.symbol, payload.market)
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ---- Watchlist ----
  ipcMain.handle(IPC_CHANNELS.WATCHLIST_LIST, async (_event, assetType?: string) => {
    try {
      const svc = getWatchlistService()
      const items = svc.list(assetType)
      return { success: true, data: items }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.WATCHLIST_ADD, async (_event, payload: { symbol: string; market: string; name?: string; asset_type?: string; origin?: 'manual' | 'trade'; notes?: string }) => {
    try {
      const svc = getWatchlistService()
      const item = await svc.add(
        payload.symbol,
        payload.market,
        payload.name,
        payload.asset_type,
        payload.origin || 'manual',
        payload.notes
      )
      return { success: true, data: item }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.WATCHLIST_REMOVE, async (_event, payload: { asset_id: string }) => {
    try {
      const svc = getWatchlistService()
      const result = svc.remove(payload.asset_id)
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.WATCHLIST_GET_DETAIL, async (_event, payload: { asset_id: string }) => {
    try {
      const svc = getWatchlistService()
      const item = svc.getDetail(payload.asset_id)
      return { success: true, data: item }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
}
