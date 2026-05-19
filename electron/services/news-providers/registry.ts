import { getDb } from '../../db/index'
import type { INewsProvider } from './interface'
import { MockNewsProvider } from './mock-provider'
import { HttpNewsProvider } from './http-provider'
import type { DataSourceConfig } from '../../../shared/types/database'

let registry: Map<string, INewsProvider> | null = null

export function getNewsProviderRegistry(): Map<string, INewsProvider> {
  if (registry) return registry

  registry = new Map()

  // Always register built-in mock provider
  const mock = new MockNewsProvider()
  registry.set(mock.id, mock)

  // Load configured HTTP providers from DB
  try {
    const db = getDb()
    const configs = db.prepare(`
      SELECT * FROM data_sources
      WHERE source_type = 'news' AND provider = 'http' AND is_enabled = 1
    `).all() as DataSourceConfig[]

    for (const cfg of configs) {
      if (cfg.base_url) {
        const provider = new HttpNewsProvider(cfg.id, cfg.name, cfg.base_url)
        registry.set(cfg.id, provider)
      }
    }
  } catch {
    // DB may not be initialized yet — fine, built-in providers are always available
  }

  return registry
}

export function getActiveNewsProvider(): INewsProvider {
  const reg = getNewsProviderRegistry()

  // Check DB for preferred provider
  try {
    const db = getDb()
    const preferred = db.prepare(`
      SELECT value FROM app_settings WHERE key = 'news_provider_id'
    `).get() as { value: string } | undefined

    if (preferred && reg.has(preferred.value)) {
      return reg.get(preferred.value)!
    }
  } catch {
    // ignore
  }

  // Default to mock
  return reg.get('mock-news')!
}

export function refreshNewsRegistry(): void {
  registry = null
  getNewsProviderRegistry()
}
