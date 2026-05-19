import { getDb } from '../../db/index'
import type { IMarketProvider } from './interface'
import { HttpMarketProvider } from './http-provider'
import { SinaJsProvider } from './sina-provider'
import { TencentProvider } from './tencent-provider'
import { EastMoneyProvider } from './eastmoney-provider'
import type { DataSourceConfig } from '../../../shared/types/database'

let registry: Map<string, IMarketProvider> | null = null

export function getMarketProviderRegistry(): Map<string, IMarketProvider> {
  if (registry) return registry

  registry = new Map()

  // Register only real data providers (no mock)
  const sina = new SinaJsProvider()
  registry.set(sina.id, sina)

  const tencent = new TencentProvider()
  registry.set(tencent.id, tencent)

  const eastmoney = new EastMoneyProvider()
  registry.set(eastmoney.id, eastmoney)

  // Load configured HTTP providers from DB
  try {
    const db = getDb()
    const configs = db.prepare(`
      SELECT * FROM data_sources
      WHERE source_type = 'market' AND provider = 'http' AND is_enabled = 1
    `).all() as DataSourceConfig[]

    for (const cfg of configs) {
      if (cfg.base_url) {
        const provider = new HttpMarketProvider(cfg.id, cfg.name, cfg.base_url)
        registry.set(cfg.id, provider)
      }
    }
  } catch {
    // DB may not be initialized yet
  }

  return registry
}

export function getActiveMarketProvider(): IMarketProvider {
  const reg = getMarketProviderRegistry()

  // Check DB for preferred provider
  try {
    const db = getDb()
    const preferred = db.prepare(`
      SELECT value FROM app_settings WHERE key = 'market_provider_id'
    `).get() as { value: string } | undefined

    if (preferred && reg.has(preferred.value)) {
      return reg.get(preferred.value)!
    }
  } catch {
    // ignore
  }

  // Default to sina-free for real market data (never fall back to mock)
  const sina = reg.get('sina-free')
  if (sina) return sina

  const tencent = reg.get('tencent-free')
  if (tencent) return tencent

  const eastmoney = reg.get('eastmoney-free')
  if (eastmoney) return eastmoney

  throw new Error('No real market provider available. Please check your network connection.')
}

export function refreshRegistry(): void {
  registry = null
  getMarketProviderRegistry()
}
