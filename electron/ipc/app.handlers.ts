import { ipcMain, dialog, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import { getMainWindow } from '../main'
import { getDb } from '../db'
import { seedDatabase } from '../db/seed'
import * as AssetRepo from '../db/repositories/asset.repository'
import * as MarketQuoteRepo from '../db/repositories/market-quote.repository'

export function registerAppHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.APP_OPEN_FILE, async () => {
    try {
      const window = getMainWindow()
      if (!window) {
        return { success: false, error: 'No active window' }
      }

      const result = await dialog.showOpenDialog(window, {
        title: '选择文件',
        properties: ['openFile'],
        filters: [
          { name: 'CSV 文件', extensions: ['csv'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, data: null }
      }

      return { success: true, data: result.filePaths[0] }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.APP_EXPORT_FILE, async (_event, payload: { defaultName: string; content: string }) => {
    try {
      const window = getMainWindow()
      if (!window) {
        return { success: false, error: 'No active window' }
      }

      const result = await dialog.showSaveDialog(window, {
        title: '导出文件',
        defaultPath: payload.defaultName || 'export.csv',
        filters: [
          { name: 'CSV 文件', extensions: ['csv'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })

      if (result.canceled || !result.filePath) {
        return { success: true, data: null }
      }

      // Write file using Node.js fs
      const fs = await import('fs')
      fs.writeFileSync(result.filePath, payload.content, 'utf-8')

      return { success: true, data: result.filePath }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ---- Data source status ----

  ipcMain.handle('app:getDataSourceStatus', async () => {
    try {
      const db = getDb()

      // Read active AI provider from ai_provider_configs (not deprecated app_settings fields)
      const activeAIId = db.prepare(
        "SELECT value FROM app_settings WHERE key = 'ai_provider_id'"
      ).get() as { value: string } | undefined

      const activeAI = activeAIId
        ? db.prepare('SELECT provider, model FROM ai_provider_configs WHERE id = ?').get(activeAIId.value) as { provider: string; model: string } | undefined
        : undefined

      const aiProvider = activeAI?.provider ?? 'mock'
      const aiModel = activeAI?.model ?? 'mock-model'

      const posCount = (db.prepare(
        'SELECT COUNT(*) AS c FROM positions WHERE quantity > 0'
      ).get() as { c: number }).c

      const quoteCount = (db.prepare(
        'SELECT COUNT(*) AS c FROM market_quotes'
      ).get() as { c: number }).c

      // Detect if real data sources are configured
      // Use the actual active provider logic (defaults to sina-free, not mock)
      const { getActiveMarketProvider } = await import('../services/market-providers/registry')
      const activeMarketProvider = getActiveMarketProvider()
      const marketSource = activeMarketProvider.provider === 'mock' ? 'simulated' : 'real'
      const isAIReal = aiProvider !== 'mock' && aiProvider !== ''

      const activeNewsId = db.prepare(
        "SELECT value FROM app_settings WHERE key = 'news_provider_id'"
      ).get() as { value: string } | undefined
      const newsProviderId = activeNewsId?.value ?? 'mock-news'
      const newsSource = newsProviderId === 'mock-news' ? 'simulated' : 'real'

      return {
        success: true,
        data: {
          market_source: marketSource,
          news_source: newsSource,
          ai_provider: aiProvider,
          ai_model: aiModel,
          is_ai_real: isAIReal,
          has_positions: posCount > 0,
          position_count: posCount
        }
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ---- File read helper for CSV import ----

  ipcMain.handle('app:readFile', async (_event, filePath: string) => {
    try {
      const fs = await import('fs')
      const content = fs.readFileSync(filePath, 'utf-8')
      return { success: true, data: content }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ---- Extended app handlers (not in official IPC_CHANNELS but used internally) ----

  ipcMain.handle('app:getState', async () => {
    try {
      const db = getDb()

      // Get market indices summary
      const positions = db.prepare(`
        SELECT COUNT(*) AS count, COALESCE(SUM(market_value), 0) AS total_value
        FROM positions WHERE quantity > 0
      `).get() as { count: number; total_value: number }

      const quotes = db.prepare(`
        SELECT COUNT(*) AS count FROM market_quotes
      `).get() as { count: number }

      const alerts = db.prepare(`
        SELECT COUNT(*) AS count FROM alerts WHERE status IN ('pending', 'triggered')
      `).get() as { count: number }

      const lastSnapshot = db.prepare(`
        SELECT risk_score, calculated_at FROM risk_snapshots
        WHERE portfolio_id = 'default'
        ORDER BY calculated_at DESC LIMIT 1
      `).get() as { risk_score: number; calculated_at: string } | undefined

      return {
        success: true,
        data: {
          positionCount: positions.count,
          totalMarketValue: positions.total_value,
          quoteCount: quotes.count,
          activeAlerts: alerts.count,
          lastRiskScore: lastSnapshot?.risk_score ?? null,
          lastSnapshotTime: lastSnapshot?.calculated_at ?? null
        }
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('app:seedData', async () => {
    try {
      const db = getDb()
      seedDatabase(db)
      return { success: true, data: null }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
}
