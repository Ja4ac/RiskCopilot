import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { AppSettings } from '../../shared/types/database'
import type { IpcTestDataSourcePayload } from '../../shared/types/ipc'
import { getDb } from '../db'
import { v4 as uuid } from 'uuid'
import { HttpMarketProvider } from '../services/market-providers/http-provider'
import { getMarketProviderRegistry } from '../services/market-providers/registry'
import { HttpNewsProvider } from '../services/news-providers/http-provider'
import { getNewsProviderRegistry } from '../services/news-providers/registry'
import { getPositionService } from '../services/portfolio'
import { createIpcHandler } from './create-handler'

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  language: 'zh-CN',
  data_refresh_interval_ms: 30000,
  ai_provider: 'mock',
  ai_model: 'mock-model',
  notifications_enabled: true,
  sound_enabled: true
}

export function registerSettingsHandlers(): void {
  createIpcHandler(IPC_CHANNELS.SETTINGS_GET, async () => {
    const db = getDb()

    // Ensure default settings exist
    const ensureStmt = db.prepare(`
      INSERT INTO app_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO NOTHING
    `)

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      ensureStmt.run(key, String(value))
    }

    // Read all settings
    const rows = db.prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[]

    const settings: AppSettings = { ...DEFAULT_SETTINGS }
    for (const row of rows) {
      const key = row.key as keyof AppSettings
      if (key in settings) {
        const val = row.value
        if (typeof settings[key] === 'number') {
          (settings as any)[key] = Number(val)
        } else if (typeof settings[key] === 'boolean') {
          (settings as any)[key] = val === 'true'
        } else {
          (settings as any)[key] = val
        }
      }
    }

    return settings
  })

  createIpcHandler(IPC_CHANNELS.SETTINGS_UPDATE, async (_event, updates: Partial<AppSettings>) => {
    const db = getDb()
    const upsertStmt = db.prepare(`
      INSERT INTO app_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = ?
    `)

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        const strValue = String(value)
        upsertStmt.run(key, strValue, strValue)
      }
    }

    // Return full settings
    const rows = db.prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[]
    const settings: AppSettings = { ...DEFAULT_SETTINGS }
    for (const row of rows) {
      const key = row.key as keyof AppSettings
      if (key in settings) {
        const val = row.value
        if (typeof settings[key] === 'number') {
          (settings as any)[key] = Number(val)
        } else if (typeof settings[key] === 'boolean') {
          (settings as any)[key] = val === 'true'
        } else {
          (settings as any)[key] = val
        }
      }
    }

    return settings
  })

  // ---- Settings: read file (for restore) ----
  createIpcHandler('settings:readFile', async (_event, filePath: string) => {
    const fs = await import('fs')
    const content = fs.readFileSync(filePath, 'utf-8')
    return content
  })

  // ---- Settings: test data source ----
  createIpcHandler(IPC_CHANNELS.SETTINGS_TEST_DATA_SOURCE, async (_event, payload: IpcTestDataSourcePayload) => {
    if (payload.source_type === 'market') {
      if (payload.source_id) {
        // Check built-in providers first (mock, sina, tencent)
        const registry = getMarketProviderRegistry()
        if (registry.has(payload.source_id)) {
          const provider = registry.get(payload.source_id)!
          const healthy = await provider.healthCheck()
          return { healthy, provider: provider.name }
        }

        // Fall back to DB sources
        const db = getDb()
        const source = db.prepare('SELECT * FROM data_sources WHERE id = ?').get(payload.source_id) as any
        if (!source) throw new Error('数据源不存在')
        const provider = new HttpMarketProvider(source.id, source.name, source.base_url)
        const healthy = await provider.healthCheck()
        return { healthy, provider: source.name }
      } else if (payload.base_url) {
        const provider = new HttpMarketProvider('test', 'Test', payload.base_url)
        const healthy = await provider.healthCheck()
        return { healthy, provider: 'Test' }
      }
      throw new Error('请提供 source_id 或 base_url')
    }

    if (payload.source_type === 'news') {
      if (payload.source_id) {
        // Check built-in providers first
        const registry = getNewsProviderRegistry()
        if (registry.has(payload.source_id)) {
          const provider = registry.get(payload.source_id)!
          const healthy = await provider.healthCheck()
          return { healthy, provider: provider.name }
        }

        // Fall back to DB sources
        const db = getDb()
        const source = db.prepare('SELECT * FROM data_sources WHERE id = ?').get(payload.source_id) as any
        if (!source) throw new Error('数据源不存在')
        const provider = new HttpNewsProvider(source.id, source.name, source.base_url)
        const healthy = await provider.healthCheck()
        return { healthy, provider: source.name }
      } else if (payload.base_url) {
        const provider = new HttpNewsProvider('test', 'Test', payload.base_url)
        const healthy = await provider.healthCheck()
        return { healthy, provider: 'Test' }
      }
      throw new Error('请提供 source_id 或 base_url')
    }

    throw new Error('暂不支持该数据源类型的测试')
  })

  // ---- Settings: export full backup ----
  createIpcHandler('settings:exportBackup', async () => {
    const db = getDb()
    const tables = ['assets', 'trades', 'positions', 'app_settings', 'ai_provider_configs', 'data_sources', 'alerts']
    const backup: Record<string, unknown> = { version: 1, exported_at: new Date().toISOString() }

    for (const table of tables) {
      try {
        backup[table] = db.prepare(`SELECT * FROM ${table}`).all()
      } catch {
        backup[table] = [] // table may not exist
      }
    }

    return JSON.stringify(backup, null, 2)
  })

  // ---- Settings: restore backup ----
  createIpcHandler('settings:restoreBackup', async (_event, payload: { content: string }) => {
    const data = JSON.parse(payload.content)
    const db = getDb()
    const now = new Date().toISOString()
    const tx = db.transaction(() => {
      // 1. Restore assets first
      if (Array.isArray(data.assets)) {
        const insertAsset = db.prepare(`
          INSERT OR IGNORE INTO assets (id, symbol, market, name, asset_type, currency, industry, style, exchange, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const a of data.assets) {
          insertAsset.run(
            a.id, a.symbol, a.market, a.name, a.asset_type, a.currency ?? 'CNY',
            a.industry ?? null, a.style ?? null, a.exchange ?? null,
            a.created_at ?? now, a.updated_at ?? now
          )
        }
      }

      // 2. Restore trades
      if (Array.isArray(data.trades)) {
        const insertTrade = db.prepare(`
          INSERT OR IGNORE INTO trades (id, asset_id, account_id, side, quantity, price, fee, tax, trade_time, source, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const t of data.trades) {
          insertTrade.run(
            t.id, t.asset_id, t.account_id || 'default', t.side, t.quantity, t.price,
            t.fee || 0, t.tax || 0, t.trade_time || now, t.source || 'restored', t.status || 'active', t.created_at ?? now
          )
        }
      }

      // 3. Restore settings (skip deprecated ai_provider/ai_model if ai_provider_configs exists)
      if (Array.isArray(data.app_settings)) {
        const upsertSetting = db.prepare(`
          INSERT INTO app_settings (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = ?
        `)
        for (const s of data.app_settings) {
          upsertSetting.run(s.key, s.value, s.value)
        }
      }

      // 4. Restore AI configs
      if (Array.isArray(data.ai_provider_configs)) {
        const insertAI = db.prepare(`
          INSERT OR IGNORE INTO ai_provider_configs
          (id, provider, name, base_url, api_key_encrypted, model, is_enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const c of data.ai_provider_configs) {
          insertAI.run(
            c.id, c.provider, c.name, c.base_url ?? null, c.api_key_encrypted ?? null,
            c.model, c.is_enabled ?? 1, c.created_at ?? now, c.updated_at ?? now
          )
        }
      }

      // 5. Restore data sources
      if (Array.isArray(data.data_sources)) {
        const insertSource = db.prepare(`
          INSERT OR IGNORE INTO data_sources
          (id, source_type, provider, name, base_url, is_enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const s of data.data_sources) {
          insertSource.run(
            s.id, s.source_type, s.provider, s.name, s.base_url ?? null,
            s.is_enabled ?? 1, s.created_at ?? now, s.updated_at ?? now
          )
        }
      }
    })

    tx()

    // 6. Recalculate all positions from restored trades
    getPositionService().recalculateAllPositions()

    return 'ok'
  })
}
