import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { IpcGetNewsPayload } from '../../shared/types/ipc'
import { NewsService } from '../services/news.service'
import { getNewsProviderRegistry, getActiveNewsProvider, refreshNewsRegistry } from '../services/news-providers/registry'
import { HttpNewsProvider } from '../services/news-providers/http-provider'
import { getDb } from '../db'

const newsService = new NewsService()

export function registerNewsHandlers(): void {
  // ---- News queries ----
  ipcMain.handle(IPC_CHANNELS.NEWS_GET_LIST, async (_event, filters?: IpcGetNewsPayload) => {
    try {
      const result = newsService.getNews(filters)
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.NEWS_GET_ASSET_NEWS, async (_event, assetId: string) => {
    try {
      const news = newsService.getAssetNews(assetId)
      return { success: true, data: news }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ---- News Data Source CRUD ----
  ipcMain.handle(IPC_CHANNELS.NEWS_LIST_SOURCES, async () => {
    try {
      const db = getDb()
      const dbSources = db.prepare(`
        SELECT id, source_type, provider, name, base_url, is_enabled,
               last_health_at, last_health_status, last_error_message, created_at
        FROM data_sources WHERE source_type = "news"
        ORDER BY created_at ASC
      `).all() as any[]

      const builtIn = [
        { id: "mock-news", source_type: "news" as const, provider: "mock", name: "本地模拟舆情", base_url: null, is_enabled: true, last_health_at: null, last_health_status: null, last_error_message: null, created_at: new Date().toISOString() },
      ]

      const dbIds = new Set(dbSources.map((s) => s.id))
      const sources = [...builtIn.filter((b) => !dbIds.has(b.id)), ...dbSources]

      const activeIdRow = db.prepare("SELECT value FROM app_settings WHERE key = 'news_provider_id'").get() as { value: string } | undefined
      const activeId = activeIdRow?.value ?? 'mock-news'

      return { success: true, data: { sources, activeId } }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.NEWS_SAVE_SOURCE, async (_event, payload: { id?: string; name: string; base_url: string; is_enabled?: boolean }) => {
    try {
      const db = getDb()
      const now = new Date().toISOString()

      if (payload.id) {
        db.prepare(`
          UPDATE data_sources
          SET name = ?, base_url = ?, is_enabled = ?, updated_at = ?
          WHERE id = ? AND source_type = "news"
        `).run(payload.name, payload.base_url, payload.is_enabled !== false ? 1 : 0, now, payload.id)
        refreshNewsRegistry()
        return { success: true, data: { id: payload.id } }
      }

      const id = `news-${Date.now()}`
      db.prepare(`
        INSERT INTO data_sources (id, source_type, provider, name, base_url, is_enabled, created_at, updated_at)
        VALUES (?, "news", "http", ?, ?, ?, ?, ?)
      `).run(id, payload.name, payload.base_url, payload.is_enabled !== false ? 1 : 0, now, now)
      refreshNewsRegistry()
      return { success: true, data: { id } }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.NEWS_DELETE_SOURCE, async (_event, id: string) => {
    try {
      const db = getDb()
      db.prepare("DELETE FROM data_sources WHERE id = ? AND source_type = \"news\" AND id != \"mock-default\"").run(id)
      refreshNewsRegistry()
      return { success: true, data: null }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.NEWS_SET_ACTIVE_SOURCE, async (_event, id: string) => {
    try {
      const db = getDb()
      db.prepare(`
        INSERT INTO app_settings (key, value) VALUES ("news_provider_id", ?)
        ON CONFLICT(key) DO UPDATE SET value = ?
      `).run(id, id)
      refreshNewsRegistry()
      return { success: true, data: null }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ---- News sync from active provider ----
  ipcMain.handle(IPC_CHANNELS.NEWS_SYNC, async () => {
    try {
      const provider = getActiveNewsProvider()
      const db = getDb()
      const now = new Date().toISOString()

      const newsItems = await provider.fetchNews({ limit: 50 })

      const insertNews = db.prepare(`
        INSERT INTO news_items (id, title, summary, source, url, published_at, sentiment, importance, raw_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          summary = excluded.summary,
          source = excluded.source,
          url = excluded.url,
          published_at = excluded.published_at,
          sentiment = excluded.sentiment,
          importance = excluded.importance
      `)

      let inserted = 0
      for (const item of newsItems) {
        insertNews.run(
          item.id,
          item.title,
          item.summary ?? null,
          item.source,
          item.url ?? null,
          item.published_at,
          item.sentiment ?? null,
          item.importance ?? "low",
          item.raw_hash ?? `${item.title}-${item.published_at}`,
          item.created_at ?? now
        )
        inserted++
      }

      const newsIds = newsItems.map((n) => n.id)
      if (newsIds.length > 0) {
        const links = await provider.fetchNewsLinks(newsIds)
        const insertLink = db.prepare(`
          INSERT INTO news_asset_links (id, news_id, asset_id, relevance, event_type)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `)
        for (const link of links) {
          insertLink.run(link.id, link.news_id, link.asset_id, link.relevance, link.event_type ?? null)
        }
      }

      try {
        db.prepare(`
          UPDATE data_sources
          SET last_health_at = ?, last_health_status = ?, updated_at = ?
          WHERE id = ?
        `).run(now, "ok", now, provider.id)
      } catch {
        // ignore for built-in providers
      }

      return { success: true, data: { inserted, provider: provider.name } }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
}