import { getDb } from '../../db/index'
import { safeStorage } from 'electron'
import { MockAIProvider } from './mock-provider'
import { OpenAIProvider } from './openai-provider'
import type { AIProviderConfigSafe } from '../../../shared/types/database'

// ---- Provider instance cache ----
let providerCache: Map<string, MockAIProvider | OpenAIProvider> | null = null

function getProviderCache(): Map<string, MockAIProvider | OpenAIProvider> {
  if (providerCache) return providerCache

  providerCache = new Map()
  const mock = new MockAIProvider()
  providerCache.set(mock.id, mock)

  // Load configured providers from DB
  try {
    const db = getDb()
    const configs = db.prepare(`
      SELECT * FROM ai_provider_configs WHERE is_enabled = 1
    `).all() as any[]

    for (const cfg of configs) {
      if (cfg.id === 'mock-default') continue // already registered
      if (cfg.provider === 'openai' || cfg.provider === 'deepseek') {
        const apiKey = cfg.api_key_encrypted
          ? safeStorage.decryptString(Buffer.from(cfg.api_key_encrypted, 'base64'))
          : ''
        const baseUrl = cfg.base_url || 'https://api.openai.com/v1'
        const model = cfg.model || 'gpt-4o'
        const provider = new OpenAIProvider(cfg.id, cfg.name, baseUrl, apiKey, model)
        providerCache.set(cfg.id, provider)
      }
    }
  } catch {
    // DB may not be initialized
  }

  return providerCache
}

export function getAIProviderById(id: string): MockAIProvider | OpenAIProvider | undefined {
  const cache = getProviderCache()
  return cache.get(id)
}

export function getActiveAI(): MockAIProvider | OpenAIProvider {
  const cache = getProviderCache()

  try {
    const db = getDb()
    const preferred = db.prepare(
      "SELECT value FROM app_settings WHERE key = 'ai_provider_id'"
    ).get() as { value: string } | undefined

    if (preferred && cache.has(preferred.value)) {
      return cache.get(preferred.value)!
    }
  } catch {
    // ignore
  }

  return cache.get('mock-ai')!
}

export function setActiveAIProvider(providerId: string): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO app_settings (key, value) VALUES ('ai_provider_id', ?)
    ON CONFLICT(key) DO UPDATE SET value = ?
  `).run(providerId, providerId)
  refreshAICache()
}

export function getModelName(): string {
  const active = getActiveAI()
  return active.model || 'mock-model'
}

export function refreshAICache(): void {
  providerCache = null
  getProviderCache()
}

// ---- AI config CRUD (safeStorage-aware) ----

export function getAIProviders(): AIProviderConfigSafe[] {
  try {
    const db = getDb()
    const configs = db.prepare('SELECT * FROM ai_provider_configs ORDER BY created_at ASC').all() as any[]
    return configs.map((cfg: any) => ({
      id: cfg.id,
      provider: cfg.provider,
      name: cfg.name,
      base_url: cfg.base_url,
      model: cfg.model,
      api_key_masked: cfg.api_key_encrypted ? '••••••••' : null,
      is_enabled: !!cfg.is_enabled,
      last_health_at: cfg.last_health_at,
      last_health_status: cfg.last_health_status,
    }))
  } catch {
    return []
  }
}

export function saveAIProvider(params: {
  id?: string
  provider: string
  name: string
  base_url?: string
  api_key?: string
  model?: string
  is_enabled?: boolean
}): string {
  const db = getDb()
  const now = new Date().toISOString()

  // Encrypt API key if provided
  let apiKeyEncrypted: string | null = null
  if (params.api_key) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统安全存储不可用，无法加密保存 API Key。请确认系统密钥环服务正常运行。')
    }
    const buf = safeStorage.encryptString(params.api_key)
    apiKeyEncrypted = buf.toString('base64')
  }

  if (params.id) {
    // Update existing
    const updates: string[] = []
    const values: any[] = []
    if (params.name !== undefined) { updates.push('name = ?'); values.push(params.name) }
    if (params.base_url !== undefined) { updates.push('base_url = ?'); values.push(params.base_url) }
    if (apiKeyEncrypted) { updates.push('api_key_encrypted = ?'); values.push(apiKeyEncrypted) }
    if (params.model !== undefined) { updates.push('model = ?'); values.push(params.model) }
    if (params.is_enabled !== undefined) { updates.push('is_enabled = ?'); values.push(params.is_enabled ? 1 : 0) }
    updates.push("updated_at = ?"); values.push(now)
    values.push(params.id)

    db.prepare(`UPDATE ai_provider_configs SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    refreshAICache()
    return params.id
  }

  // Insert new
  const id = params.id || `ai-${Date.now()}`
  db.prepare(`
    INSERT INTO ai_provider_configs (id, provider, name, base_url, api_key_encrypted, model, is_enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, params.provider, params.name, params.base_url || null,
    apiKeyEncrypted, params.model || '', params.is_enabled !== false ? 1 : 0, now, now
  )
  refreshAICache()
  return id
}

export function deleteAIProvider(id: string): void {
  const db = getDb()
  db.prepare("DELETE FROM ai_provider_configs WHERE id = ? AND id != 'mock-default'").run(id)
  refreshAICache()
}
