import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { IpcAddTradePayload, IpcUpsertAssetPayload, IpcImportPreviewPayload, IpcImportFilePayload, IpcAddFundPurchasePayload } from '../../shared/types/ipc'
import type { Market } from '../../shared/types/database'
import {
  getTradeService,
  getFundTradeService,
  getImportService,
  getPositionService,
  getPortfolioQueryService
} from '../services/portfolio'
import { getWatchlistService } from '../services/watchlist.service'
import { getActiveMarketProvider } from '../services/market-providers/registry'
import { getInstrumentSearchService } from '../services/instrument-search.service'
import * as AssetRepo from '../db/repositories/asset.repository'
import { getDb } from '../db'
import { v4 as uuid } from 'uuid'
import * as fs from 'fs'
import * as path from 'path'
import { createIpcHandler } from './create-handler'

/** Look up real asset name from stock_listings, filtered by market AND asset_type (user's choice) */
function resolveNameFromListings(symbol: string, market: string, assetType?: string): string | null {
  const db = getDb()
  // Try asset_type-specific lookup first
  if (assetType) {
    const typeFilter = assetType === 'stock' ? "asset_type IN ('stock','etf')" : "asset_type = 'fund'"
    const byMarket = db.prepare(`
      SELECT name FROM stock_listings WHERE symbol = ? AND market = ? AND is_active = 1 AND ${typeFilter} LIMIT 1
    `).get(symbol, market) as { name: string } | undefined
    if (byMarket?.name) return byMarket.name
    // Fallback: try any market (fund listings use 'SH' but fund purchases use 'OF')
    const anyMarket = db.prepare(`
      SELECT name FROM stock_listings WHERE symbol = ? AND is_active = 1 AND ${typeFilter} LIMIT 1
    `).get(symbol) as { name: string } | undefined
    if (anyMarket?.name) return anyMarket.name
  }
  // When no assetType provided (TradeModal omits it), try to find any listing for this symbol
  if (!assetType) {
    // Try exact market first
    const byMarket = db.prepare(`
      SELECT name FROM stock_listings WHERE symbol = ? AND market = ? AND is_active = 1 LIMIT 1
    `).get(symbol, market) as { name: string } | undefined
    if (byMarket?.name) return byMarket.name
    // Fallback: try any market (listings may have different markets than user entered)
    const anyMarket = db.prepare(`
      SELECT name FROM stock_listings WHERE symbol = ? AND is_active = 1 LIMIT 1
    `).get(symbol) as { name: string } | undefined
    if (anyMarket?.name) return anyMarket.name
  }
  // Fallback: assets table may already have a real name
  const existing = db.prepare(
    `SELECT name FROM assets WHERE symbol = ? AND name != ? LIMIT 1`
  ).get(symbol, symbol) as { name: string } | undefined
  if (existing?.name) return existing.name

  return null
}

/** Fetch a fresh quote for an asset by trying all available providers, write to market_quotes */
async function refreshQuoteForAsset(assetId: string): Promise<void> {
  const db = getDb()
  const asset = AssetRepo.getById(assetId)
  if (!asset) return

  // Try all providers in order, use first valid result
  const providers = [getActiveMarketProvider()]
  const { getMarketProviderRegistry } = await import('../services/market-providers/registry')
  for (const p of getMarketProviderRegistry().values()) {
    if (!providers.find((x) => x.id === p.id)) providers.push(p)
  }

  for (const provider of providers) {
    try {
      const quotes = await provider.getQuotes([{ symbol: asset.symbol, market: asset.market as Market }])
      if (quotes.length > 0 && quotes[0].price != null && quotes[0].price > 0) {
        let price = quotes[0].price
        // Sanity check: if price > 100 for a non-fund A-share, might be 分 units (981分 = 9.81元)
        // US/HK stocks have their own currency — skip normalization.
        if (asset.market !== 'US' && asset.market !== 'HK' && price > 100 && asset.asset_type !== 'fund') {
          const inYuan = price / 100
          if (inYuan > 0.5 && inYuan < 100) {
            console.warn(`[refreshQuote] ${provider.id} → ${asset.symbol}: detected 分-unit price ${price}, converting to ${inYuan}元`)
            price = inYuan
          }
        }
        db.prepare(`
          INSERT INTO market_quotes (id, asset_id, price, change_pct, volume, turnover, quote_time, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(uuid(), assetId, price, quotes[0].change_pct, quotes[0].volume, quotes[0].turnover, quotes[0].quote_time, quotes[0].source)
        // Keep only the newest quote for this asset
        db.prepare(`DELETE FROM market_quotes WHERE asset_id = ? AND id NOT IN (SELECT id FROM market_quotes WHERE asset_id = ? ORDER BY quote_time DESC LIMIT 1)`)
          .run(assetId, assetId)
        console.log(`[refreshQuote] ${provider.id} → ${asset.symbol}: ${price}`)
        return // first valid result wins
      }
    } catch (e: any) {
      console.warn(`[refreshQuote] ${provider.id} failed for ${asset.symbol}: ${e.message}`)
    }
  }
  console.warn(`[refreshQuote] All providers failed for ${asset.symbol}, keeping existing quote`)
}

export function registerPortfolioHandlers(): void {
  createIpcHandler(IPC_CHANNELS.PORTFOLIO_GET_POSITIONS, async () => {
    return getPositionService().getPositionsWithDetails()
  })

  createIpcHandler(IPC_CHANNELS.PORTFOLIO_GET_SUMMARY, async () => {
    return getPositionService().getSummary()
  })

  createIpcHandler(IPC_CHANNELS.PORTFOLIO_ADD_TRADE, async (_event, payload: IpcAddTradePayload) => {
    // Resolve asset_id from symbol+market if not provided directly
    let assetId = payload.asset_id
    if (!assetId && payload.symbol) {
      // Auto-resolve real name from stock_listings if user entered only a symbol
      let resolvedName = payload.asset_name
      if (!resolvedName || resolvedName === payload.symbol) {
        resolvedName = resolveNameFromListings(payload.symbol, payload.market || 'SZ', payload.asset_type) ?? ''
      }
      // Fallback: instrument search (has online EastMoney API fallback)
      if (!resolvedName || resolvedName === payload.symbol) {
        try {
          const searchSvc = getInstrumentSearchService()
          const searchResult = await searchSvc.search(payload.symbol, undefined, 1, 0, { allowOnlineFallback: true })
          if (searchResult.results.length > 0 && searchResult.results[0].listing?.name) {
            resolvedName = searchResult.results[0].listing.name
          }
        } catch (e: any) {
          console.warn(`[Portfolio] Online name fallback failed for ${payload.symbol}:`, e.message)
        }
      }

      // Fallback: proxy name resolution when stock_listings doesn't have this symbol
      if (!resolvedName || resolvedName === payload.symbol) {
        const { resolveNameFromProxy } = await import('../services/data-proxy')
        const proxyName = await resolveNameFromProxy(payload.symbol)
        if (proxyName) resolvedName = proxyName
      }
      if (!resolvedName) resolvedName = payload.symbol
      const asset = AssetRepo.upsert({
        symbol: payload.symbol,
        market: payload.market || 'SZ',
        name: resolvedName,
        asset_type: payload.asset_type,
        currency: payload.currency,
      })
      assetId = asset.id
    }
    if (!assetId) {
      throw new Error('必须提供 asset_id 或 symbol+market')
    }

    // Fetch a fresh quote before calculating position (avoids stale/wrong quotes)
    await refreshQuoteForAsset(assetId)

    const trade = getTradeService().addTrade({ ...payload, asset_id: assetId })

    // Auto-add to watchlist on trade (best-effort, non-blocking)
    try {
      const asset = AssetRepo.getById(assetId)
      if (asset) {
        const wlSvc = getWatchlistService()
        await wlSvc.add(asset.symbol, asset.market, asset.name, asset.asset_type, 'trade')
      }
    } catch (e: any) {
      console.warn(`[Portfolio] Auto-add to watchlist failed for asset ${assetId}:`, e.message)
    }

    return trade
  })

  createIpcHandler(IPC_CHANNELS.PORTFOLIO_ADD_FUND_PURCHASE, async (_event, payload: IpcAddFundPurchasePayload) => {
    const trade = await getFundTradeService().addFundPurchase(payload)

    // Auto-add to watchlist (best-effort)
    try {
      const asset = AssetRepo.getById(trade.asset_id)
      if (asset) {
        const wlSvc = getWatchlistService()
        await wlSvc.add(asset.symbol, asset.market, asset.name, asset.asset_type, 'trade')
      }
    } catch (e: any) {
      console.warn(`[Portfolio] Auto-add fund to watchlist failed:`, e.message)
    }

    return trade
  })

  createIpcHandler(IPC_CHANNELS.PORTFOLIO_UPDATE_TRADE, async (_event, payload: { tradeId: string; updates: Partial<IpcAddTradePayload> }) => {
    return getTradeService().updateTrade(payload.tradeId, payload.updates)
  })

  createIpcHandler(IPC_CHANNELS.PORTFOLIO_VOID_TRADE, async (_event, tradeId: string) => {
    return getTradeService().voidTrade(tradeId)
  })

  createIpcHandler(IPC_CHANNELS.PORTFOLIO_IMPORT_CSV, async (_event, payload: { csvContent: string; accountId?: string }) => {
    const accountId = payload.accountId || 'default'
    return getImportService().importCSV(payload.csvContent, accountId)
  })

  createIpcHandler(IPC_CHANNELS.PORTFOLIO_GET_FUND_PERFORMANCE, async (_event, payload: { symbol: string; market: string; range?: '1m' | '3m' | '6m' | '1y' | 'all' }) => {
    return getFundTradeService().getFundPerformance(payload.symbol, payload.market, payload.range || 'all')
  })

  createIpcHandler(IPC_CHANNELS.PORTFOLIO_GET_PORTFOLIO_PERFORMANCE, async (_event, range: '1m' | '3m' | '6m' | '1y' | 'all' = 'all') => {
    return getPortfolioQueryService().getPortfolioPerformance(range)
  })

  createIpcHandler(IPC_CHANNELS.PORTFOLIO_EXPORT_CSV, async (_event, dataType: 'positions' | 'trades') => {
    return getPortfolioQueryService().exportCSV(dataType)
  })

  createIpcHandler(IPC_CHANNELS.PORTFOLIO_GET_TRADES, async (_event, assetId?: string) => {
    return getTradeService().getTrades(assetId)
  })

  createIpcHandler(IPC_CHANNELS.PORTFOLIO_GET_ASSETS, async () => {
    return AssetRepo.getAll()
  })

  createIpcHandler(IPC_CHANNELS.PORTFOLIO_UPSERT_ASSET, async (_event, payload: IpcUpsertAssetPayload) => {
    return AssetRepo.upsert({
      symbol: payload.symbol,
      market: payload.market,
      name: payload.name,
      asset_type: payload.asset_type,
      currency: payload.currency,
    })
  })

  // ---- File import: preview (with validation) ----
  createIpcHandler(IPC_CHANNELS.PORTFOLIO_IMPORT_PREVIEW, async (_event, payload: IpcImportPreviewPayload) => {
    const allowedExtensions = ['.csv', '.txt']
    const ext = path.extname(payload.filePath).toLowerCase()
    if (!allowedExtensions.includes(ext)) {
      throw new Error(`不支持的文件格式: ${ext}。MVP 仅支持 CSV 文件。`)
    }
    if (!fs.existsSync(payload.filePath)) {
      throw new Error('文件不存在')
    }
    return getImportService().previewImport(payload.filePath)
  })

  // ---- File import: commit (with validation) ----
  createIpcHandler(IPC_CHANNELS.PORTFOLIO_IMPORT_FILE, async (_event, payload: IpcImportFilePayload) => {
    const allowedExtensions = ['.csv', '.txt']
    const ext = path.extname(payload.filePath).toLowerCase()
    if (!allowedExtensions.includes(ext)) {
      throw new Error(`不支持的文件格式: ${ext}。MVP 仅支持 CSV 文件。`)
    }
    if (!fs.existsSync(payload.filePath)) {
      throw new Error('文件不存在')
    }
    const accountId = payload.accountId || 'default'
    return getImportService().commitImport(payload.filePath, payload.fieldMapping, accountId)
  })
}
