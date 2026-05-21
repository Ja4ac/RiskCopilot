import { dialog, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import { getMainWindow } from '../main'
import { getDb } from '../db'
import { seedDatabase } from '../db/seed'
import * as AssetRepo from '../db/repositories/asset.repository'
import * as MarketQuoteRepo from '../db/repositories/market-quote.repository'
import { createIpcHandler } from './create-handler'

export function registerAppHandlers(): void {
  createIpcHandler(IPC_CHANNELS.APP_OPEN_FILE, async () => {
    const window = getMainWindow()
    if (!window) {
      throw new Error('No active window')
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
      return null
    }

    return result.filePaths[0]
  })

  createIpcHandler(IPC_CHANNELS.APP_EXPORT_FILE, async (_event, payload: { defaultName: string; content: string }) => {
    const window = getMainWindow()
    if (!window) {
      throw new Error('No active window')
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
      return null
    }

    // Write file using Node.js fs
    const fs = await import('fs')
    fs.writeFileSync(result.filePath, payload.content, 'utf-8')

    return result.filePath
  })

  // ---- Data source status ----

  createIpcHandler('app:getDataSourceStatus', async () => {
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
      market_source: marketSource,
      news_source: newsSource,
      ai_provider: aiProvider,
      ai_model: aiModel,
      is_ai_real: isAIReal,
      has_positions: posCount > 0,
      position_count: posCount
    }
  })

  // ---- File read helper for CSV import ----

  createIpcHandler('app:readFile', async (_event, filePath: string) => {
    const fs = await import('fs')
    const content = fs.readFileSync(filePath, 'utf-8')
    return content
  })

  // ---- Extended app handlers (not in official IPC_CHANNELS but used internally) ----

  createIpcHandler('app:getState', async () => {
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
      positionCount: positions.count,
      totalMarketValue: positions.total_value,
      quoteCount: quotes.count,
      activeAlerts: alerts.count,
      lastRiskScore: lastSnapshot?.risk_score ?? null,
      lastSnapshotTime: lastSnapshot?.calculated_at ?? null
    }
  })

  createIpcHandler('app:seedData', async () => {
    const db = getDb()
    seedDatabase(db)
    return null
  })

  createIpcHandler(IPC_CHANNELS.APP_CLEAR_ALL_DATA, async () => {
    const db = getDb()
    // Only delete from tables that actually exist (handles partial migrations)
    const existing = new Set(
      (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]).map(r => r.name)
    )
    // Order matters: children before parents to respect FK constraints
    const candidates = [
      'market_quotes', 'kline_bars', 'kline_bars_new',
      'news_asset_links', 'positions', 'trades', 'watchlist_items',
      'portfolio_daily_value', 'corporate_actions',
      'import_errors',
      'fund_navs', 'fund_holdings', 'fund_performances', 'fund_profiles',
      'assets', 'news_items', 'alerts', 'risk_snapshots', 'reports', 'import_jobs',
    ]
    const tablesToClear = candidates.filter(t => existing.has(t))
    db.transaction(() => {
      for (const table of tablesToClear) {
        db.prepare(`DELETE FROM ${table}`).run()
      }
    })()
    console.log(`[APP] Cleared ${tablesToClear.length} tables (kept reference/config)`)
    return null
  })
}
