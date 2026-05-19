import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { IpcAddTradePayload, IpcUpsertAssetPayload, IpcImportPreviewPayload, IpcImportFilePayload, IpcAddFundPurchasePayload } from '../../shared/types/ipc'
import { PortfolioService } from '../services/portfolio.service'
import { getWatchlistService } from '../services/watchlist.service'
import * as AssetRepo from '../db/repositories/asset.repository'
import * as fs from 'fs'
import * as path from 'path'

const portfolioService = new PortfolioService()

export function registerPortfolioHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.PORTFOLIO_GET_POSITIONS, async () => {
    try {
      const positions = portfolioService.getPositionsWithDetails()
      return { success: true, data: positions }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PORTFOLIO_GET_SUMMARY, async () => {
    try {
      const summary = portfolioService.getSummary()
      return { success: true, data: summary }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PORTFOLIO_ADD_TRADE, async (_event, payload: IpcAddTradePayload) => {
    try {
      // Resolve asset_id from symbol+market if not provided directly
      let assetId = payload.asset_id
      if (!assetId && payload.symbol) {
        const asset = AssetRepo.upsert({
          symbol: payload.symbol,
          market: payload.market || 'SZ',
          name: payload.asset_name,
          asset_type: payload.asset_type,
          currency: payload.currency,
        })
        assetId = asset.id
      }
      if (!assetId) {
        return { success: false, error: '必须提供 asset_id 或 symbol+market' }
      }
      const trade = portfolioService.addTrade({ ...payload, asset_id: assetId })

      // Auto-add to watchlist on trade
      try {
        const asset = AssetRepo.getById(assetId)
        if (asset) {
          const wlSvc = getWatchlistService()
          await wlSvc.add(asset.symbol, asset.market, asset.name, asset.asset_type, 'trade')
          console.log(`[Portfolio] Auto-added to watchlist: ${asset.symbol} (${asset.name})`)
        }
      } catch (e: any) {
        console.error(`[Portfolio] Auto-add to watchlist failed for asset ${assetId}:`, e.message)
      }

      return { success: true, data: trade }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PORTFOLIO_ADD_FUND_PURCHASE, async (_event, payload: IpcAddFundPurchasePayload) => {
    console.log(`[IPC] PORTFOLIO_ADD_FUND_PURCHASE called:`, payload)
    try {
      const trade = await portfolioService.addFundPurchase(payload)
      console.log(`[IPC] Fund purchase added successfully: tradeId=${trade.id}`)

      // Auto-add to watchlist
      try {
        const asset = AssetRepo.getById(trade.asset_id)
        if (asset) {
          const wlSvc = getWatchlistService()
          await wlSvc.add(asset.symbol, asset.market, asset.name, asset.asset_type, 'trade')
          console.log(`[Portfolio] Auto-added fund to watchlist: ${asset.symbol} (${asset.name})`)
        }
      } catch (e: any) {
        console.error(`[Portfolio] Auto-add fund to watchlist failed:`, e.message)
      }

      return { success: true, data: trade }
    } catch (error: any) {
      console.error(`[IPC] PORTFOLIO_ADD_FUND_PURCHASE failed:`, error.message)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PORTFOLIO_UPDATE_TRADE, async (_event, payload: { tradeId: string; updates: Partial<IpcAddTradePayload> }) => {
    try {
      const trade = portfolioService.updateTrade(payload.tradeId, payload.updates)
      return { success: true, data: trade }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PORTFOLIO_VOID_TRADE, async (_event, tradeId: string) => {
    try {
      const trade = portfolioService.voidTrade(tradeId)
      return { success: true, data: trade }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PORTFOLIO_IMPORT_CSV, async (_event, payload: { csvContent: string; accountId?: string }) => {
    try {
      const accountId = payload.accountId || 'default'
      const result = portfolioService.importCSV(payload.csvContent, accountId)
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PORTFOLIO_GET_FUND_PERFORMANCE, async (_event, payload: { symbol: string; market: string; range?: '1m' | '3m' | '6m' | '1y' | 'all' }) => {
    try {
      const result = await portfolioService.getFundPerformance(payload.symbol, payload.market, payload.range || 'all')
      return { success: true, data: result }
    } catch (error: any) {
      const errorMsg = error?.message || (error === undefined ? 'Unknown error occurred' : String(error)) || 'Failed to fetch fund performance'
      console.error(`[IPC] getFundPerformance failed for ${payload?.symbol}:`, error)
      return { success: false, error: errorMsg }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PORTFOLIO_GET_PORTFOLIO_PERFORMANCE, async (_event, range: '1m' | '3m' | '6m' | '1y' | 'all' = 'all') => {
    try {
      const result = portfolioService.getPortfolioPerformance(range)
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PORTFOLIO_EXPORT_CSV, async (_event, dataType: 'positions' | 'trades') => {
    try {
      const csv = portfolioService.exportCSV(dataType)
      return { success: true, data: csv }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PORTFOLIO_GET_TRADES, async (_event, assetId?: string) => {
    try {
      const trades = portfolioService.getTrades(assetId)
      return { success: true, data: trades }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PORTFOLIO_GET_ASSETS, async () => {
    try {
      const assets = AssetRepo.getAll()
      return { success: true, data: assets }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ---- Upsert asset by symbol + market ----
  ipcMain.handle(IPC_CHANNELS.PORTFOLIO_UPSERT_ASSET, async (_event, payload: IpcUpsertAssetPayload) => {
    try {
      const asset = AssetRepo.upsert({
        symbol: payload.symbol,
        market: payload.market,
        name: payload.name,
        asset_type: payload.asset_type,
        currency: payload.currency,
      })
      return { success: true, data: asset }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ---- File import: preview ----
  ipcMain.handle(IPC_CHANNELS.PORTFOLIO_IMPORT_PREVIEW, async (_event, payload: IpcImportPreviewPayload) => {
    try {
      const allowedExtensions = ['.csv', '.txt']
      const ext = path.extname(payload.filePath).toLowerCase()
      if (!allowedExtensions.includes(ext)) {
        return { success: false, error: `不支持的文件格式: ${ext}。MVP 仅支持 CSV 文件。` }
      }
      if (!fs.existsSync(payload.filePath)) {
        return { success: false, error: '文件不存在' }
      }
      const result = portfolioService.previewImport(payload.filePath)
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ---- File import: commit ----
  ipcMain.handle(IPC_CHANNELS.PORTFOLIO_IMPORT_FILE, async (_event, payload: IpcImportFilePayload) => {
    try {
      const allowedExtensions = ['.csv', '.txt']
      const ext = path.extname(payload.filePath).toLowerCase()
      if (!allowedExtensions.includes(ext)) {
        return { success: false, error: `不支持的文件格式: ${ext}。MVP 仅支持 CSV 文件。` }
      }
      if (!fs.existsSync(payload.filePath)) {
        return { success: false, error: '文件不存在' }
      }
      const accountId = payload.accountId || 'default'
      const result = portfolioService.commitImport(payload.filePath, payload.fieldMapping, accountId)
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
}
