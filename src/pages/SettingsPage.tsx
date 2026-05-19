import { useEffect, useState } from 'react'
import { useSettingsStore } from '@/stores/settings.store'
import { ipcInvoke } from '@/hooks/useIPC'
import { IPC_CHANNELS } from '@/types'
import { Panel } from '@/components/ui/Panel'
import { Skeleton } from '@/components/ui/Skeleton'
import type { AppSettings } from '@shared/types/database'

// ── Market Data Source Configuration ────────────────────────────
function MarketSourcePanel({ setGlobalStatus }: { setGlobalStatus: (s: string | null) => void }) {
  const [sources, setSources] = useState<any[]>([])
  const [activeId, setActiveId] = useState<string>('mock-market')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', base_url: '', is_enabled: true })
  const [testingId, setTestingId] = useState<string | null>(null)

  useEffect(() => { loadSources() }, [])

  const loadSources = async () => {
    try {
      const result = await ipcInvoke<{ sources: any[]; activeId: string }>(IPC_CHANNELS.MARKET_LIST_SOURCES)
      if (result) {
        setSources(result.sources || [])
        setActiveId(result.activeId || 'mock-market')
      }
    } catch { /* ignore */ }
  }

  const startEdit = (s?: any) => {
    if (s) {
      setEditingId(s.id)
      setEditForm({ name: s.name, base_url: s.base_url || '', is_enabled: s.is_enabled !== false })
    } else {
      setEditingId('__new__')
      setEditForm({ name: '', base_url: '', is_enabled: true })
    }
  }

  const addPreset = async (preset: 'sina' | 'tencent' | 'mock') => {
    const idMap = { sina: 'sina-free', tencent: 'tencent-free', mock: 'mock-market' }
    const nameMap = { sina: '新浪免费行情', tencent: '腾讯免费行情', mock: '本地模拟行情' }
    const id = idMap[preset]
    try {
      await ipcInvoke(IPC_CHANNELS.MARKET_SET_ACTIVE_SOURCE, id)
      setGlobalStatus(`已切换为 ${nameMap[preset]}`)
      await loadSources()
    } catch (e: any) {
      setGlobalStatus(`切换失败: ${e.message}`)
    }
  }

  const handleSave = async () => {
    try {
      await ipcInvoke(IPC_CHANNELS.MARKET_SAVE_SOURCE, {
        id: editingId === '__new__' ? undefined : editingId,
        ...editForm,
      })
      setEditingId(null)
      setGlobalStatus('行情数据源已保存')
      await loadSources()
    } catch (e: any) {
      setGlobalStatus(`保存失败: ${e.message}`)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除此行情数据源？')) return
    try {
      await ipcInvoke(IPC_CHANNELS.MARKET_DELETE_SOURCE, id)
      setGlobalStatus('行情数据源已删除')
      await loadSources()
    } catch (e: any) {
      setGlobalStatus(`删除失败: ${e.message}`)
    }
  }

  const handleTest = async (id: string): Promise<boolean> => {
    setTestingId(id)
    try {
      const result = await ipcInvoke<{ healthy: boolean; provider: string }>(
        IPC_CHANNELS.SETTINGS_TEST_DATA_SOURCE,
        { source_type: 'market', source_id: id }
      )
      const ok = result.healthy
      setGlobalStatus(ok ? `连接成功: ${result.provider}` : `连接失败: ${result.provider}`)
      return ok
    } catch (e: any) {
      setGlobalStatus(`测试失败: ${e.message}`)
      return false
    } finally {
      setTestingId(null)
    }
  }

  const handleSetActive = async (id: string) => {
    const ok = await handleTest(id)
    if (!ok) return
    try {
      await ipcInvoke(IPC_CHANNELS.MARKET_SET_ACTIVE_SOURCE, id)
      setGlobalStatus('已设为当前行情源')
      await loadSources()
    } catch (e: any) {
      setGlobalStatus(`设置失败: ${e.message}`)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {sources.map((s) => {
        const isActive = s.id === activeId
        return (
        <div
          key={s.id}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 12px', borderBottom: '1px solid var(--line)',
            borderRadius: 8,
            background: isActive ? 'rgba(47,101,217,0.06)' : undefined,
            border: isActive ? '1px solid rgba(47,101,217,0.3)' : undefined,
          }}
        >
          <div style={{ flex: 1 }}>
            <strong style={{ fontSize: 13, display: 'block' }}>
              {s.name} {isActive ? <span style={{ color: 'var(--blue)', fontSize: 11, marginLeft: 4 }}>● 当前使用中</span> : ''}
              {s.is_enabled === false ? <span style={{ color: 'var(--muted)' }}>(已禁用)</span> : ''}
            </strong>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {s.provider} | {s.base_url || '本地模拟'}
            </span>
            <span style={{ fontSize: 11, color: s.last_health_status === 'ok' ? 'var(--green)' : 'var(--muted)', marginLeft: 8 }}>
              {s.last_health_at ? `上次检测: ${new Date(s.last_health_at).toLocaleString('zh-CN')}` : '未检测'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              className={isActive ? 'primary-button' : 'icon-button'}
              style={{ fontSize: 12 }}
              onClick={() => handleSetActive(s.id)}
              disabled={isActive}
            >
              {isActive ? '当前使用中' : '设为当前'}
            </button>
            <button className="icon-button" style={{ fontSize: 12 }} onClick={() => handleTest(s.id)} disabled={testingId === s.id}>
              {testingId === s.id ? '测试中...' : '测试连接'}
            </button>
            {s.id !== 'mock-default' && (
              <>
                <button className="icon-button" style={{ fontSize: 12 }} onClick={() => startEdit(s)}>编辑</button>
                <button className="icon-button" style={{ fontSize: 12, color: 'var(--red)' }} onClick={() => handleDelete(s.id)}>删除</button>
              </>
            )}
          </div>
        </div>
      )})}

      {editingId ? (
        <div style={{ display: 'grid', gap: 10, padding: '12px 0', borderTop: '1px solid var(--line)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>名称</label>
              <input
                placeholder="如: 本地代理"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                style={{ width: '100%', height: 36, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>Base URL</label>
              <input
                placeholder="http://localhost:3001"
                value={editForm.base_url}
                onChange={(e) => setEditForm({ ...editForm, base_url: e.target.value })}
                style={{ width: '100%', height: 36, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary-button" onClick={handleSave}>保存</button>
            <button className="icon-button" onClick={() => setEditingId(null)}>取消</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>快速切换内置行情源（无需配置，点击即用）：</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="primary-button" onClick={() => addPreset('sina')}>切换新浪免费源</button>
            <button className="primary-button" onClick={() => addPreset('tencent')}>切换腾讯免费源</button>
            <button className="primary-button" onClick={() => addPreset('mock')}>切换本地模拟</button>
          </div>
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <button className="icon-button" onClick={() => startEdit()}>+ 自定义 HTTP 数据源</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── News Source Configuration ───────────────────────────────────
function NewsSourcePanel({ setGlobalStatus }: { setGlobalStatus: (s: string | null) => void }) {
  const [sources, setSources] = useState<any[]>([])
  const [activeId, setActiveId] = useState<string>('mock-news')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', base_url: '', is_enabled: true })
  const [testingId, setTestingId] = useState<string | null>(null)

  useEffect(() => { loadSources() }, [])

  const loadSources = async () => {
    try {
      const result = await ipcInvoke<{ sources: any[]; activeId: string }>(IPC_CHANNELS.NEWS_LIST_SOURCES)
      if (result) {
        setSources(result.sources || [])
        setActiveId(result.activeId || 'mock-news')
      }
    } catch { /* ignore */ }
  }

  const startEdit = (s?: any) => {
    if (s) {
      setEditingId(s.id)
      setEditForm({ name: s.name, base_url: s.base_url || '', is_enabled: s.is_enabled !== false })
    } else {
      setEditingId('__new__')
      setEditForm({ name: '', base_url: '', is_enabled: true })
    }
  }

  const handleSave = async () => {
    try {
      await ipcInvoke(IPC_CHANNELS.NEWS_SAVE_SOURCE, {
        id: editingId === '__new__' ? undefined : editingId,
        ...editForm,
      })
      setEditingId(null)
      setGlobalStatus('舆情数据源已保存')
      await loadSources()
    } catch (e: any) {
      setGlobalStatus(`保存失败: ${e.message}`)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除此舆情数据源？')) return
    try {
      await ipcInvoke(IPC_CHANNELS.NEWS_DELETE_SOURCE, id)
      setGlobalStatus('舆情数据源已删除')
      await loadSources()
    } catch (e: any) {
      setGlobalStatus(`删除失败: ${e.message}`)
    }
  }

  const handleTest = async (id: string): Promise<boolean> => {
    setTestingId(id)
    try {
      const result = await ipcInvoke<{ healthy: boolean; provider: string }>(
        IPC_CHANNELS.SETTINGS_TEST_DATA_SOURCE,
        { source_type: 'news', source_id: id }
      )
      const ok = result.healthy
      setGlobalStatus(ok ? `连接成功: ${result.provider}` : `连接失败: ${result.provider}`)
      return ok
    } catch (e: any) {
      setGlobalStatus(`测试失败: ${e.message}`)
      return false
    } finally {
      setTestingId(null)
    }
  }

  const handleSetActive = async (id: string) => {
    const ok = await handleTest(id)
    if (!ok) return
    try {
      await ipcInvoke(IPC_CHANNELS.NEWS_SET_ACTIVE_SOURCE, id)
      setGlobalStatus('已设为当前舆情源')
      await loadSources()
    } catch (e: any) {
      setGlobalStatus(`设置失败: ${e.message}`)
    }
  }

  const handleSync = async () => {
    try {
      setGlobalStatus('正在同步舆情数据...')
      const result = await ipcInvoke<{ inserted: number; provider: string }>(IPC_CHANNELS.NEWS_SYNC)
      setGlobalStatus(`舆情同步完成: ${result.inserted} 条来自 ${result.provider}`)
      await loadSources()
    } catch (e: any) {
      setGlobalStatus(`同步失败: ${e.message}`)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {sources.map((s) => {
        const isActive = s.id === activeId
        return (
        <div
          key={s.id}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 12px', borderBottom: '1px solid var(--line)',
            borderRadius: 8,
            background: isActive ? 'rgba(47,101,217,0.06)' : undefined,
            border: isActive ? '1px solid rgba(47,101,217,0.3)' : undefined,
          }}
        >
          <div style={{ flex: 1 }}>
            <strong style={{ fontSize: 13, display: 'block' }}>
              {s.name} {isActive ? <span style={{ color: 'var(--blue)', fontSize: 11, marginLeft: 4 }}>● 当前使用中</span> : ''}
              {s.is_enabled === false ? <span style={{ color: 'var(--muted)' }}>(已禁用)</span> : ''}
            </strong>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {s.provider} | {s.base_url || '本地模拟'}
            </span>
            <span style={{ fontSize: 11, color: s.last_health_status === 'ok' ? 'var(--green)' : 'var(--muted)', marginLeft: 8 }}>
              {s.last_health_at ? `上次检测: ${new Date(s.last_health_at).toLocaleString('zh-CN')}` : '未检测'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              className={isActive ? 'primary-button' : 'icon-button'}
              style={{ fontSize: 12 }}
              onClick={() => handleSetActive(s.id)}
              disabled={isActive}
            >
              {isActive ? '当前使用中' : '设为当前'}
            </button>
            <button className="icon-button" style={{ fontSize: 12 }} onClick={() => handleTest(s.id)} disabled={testingId === s.id}>
              {testingId === s.id ? '测试中...' : '测试连接'}
            </button>
            {s.id !== 'mock-news' && (
              <>
                <button className="icon-button" style={{ fontSize: 12 }} onClick={() => startEdit(s)}>编辑</button>
                <button className="icon-button" style={{ fontSize: 12, color: 'var(--red)' }} onClick={() => handleDelete(s.id)}>删除</button>
              </>
            )}
          </div>
        </div>
      )})}

      {editingId ? (
        <div style={{ display: 'grid', gap: 10, padding: '12px 0', borderTop: '1px solid var(--line)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>名称</label>
              <input
                placeholder="如: 财联社API"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                style={{ width: '100%', height: 36, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>Base URL</label>
              <input
                placeholder="https://api.example.com/v1"
                value={editForm.base_url}
                onChange={(e) => setEditForm({ ...editForm, base_url: e.target.value })}
                style={{ width: '100%', height: 36, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary-button" onClick={handleSave}>保存</button>
            <button className="icon-button" onClick={() => setEditingId(null)}>取消</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>当前使用内置模拟舆情数据。接入外部 API 需对方提供 /news /news/links /health 接口：</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="primary-button" onClick={handleSync}>同步舆情数据</button>
            <button className="icon-button" onClick={() => startEdit()}>+ 自定义 HTTP 舆情源</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── AI Provider Configuration ───────────────────────────────────
function AIProviderPanel({ saving, setGlobalStatus }: { saving: boolean; setGlobalStatus: (s: string | null) => void }) {
  const [providers, setProviders] = useState<any[]>([])
  const [activeId, setActiveId] = useState<string>('mock-ai')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({
    provider: 'openai', name: '', base_url: '', api_key: '', model: 'gpt-4o',
  })
  const [testingId, setTestingId] = useState<string | null>(null)
  const [settingActiveId, setSettingActiveId] = useState<string | null>(null)

  useEffect(() => {
    loadProviders()
  }, [])

  const loadProviders = async () => {
    try {
      const status = await ipcInvoke<{ providers: any[]; active_id: string }>(IPC_CHANNELS.AI_GET_PROVIDER_STATUS)
      if (status) {
        setProviders(status.providers || [])
        setActiveId(status.active_id || 'mock-ai')
      }
    } catch { /* ignore */ }
  }

  const startEdit = (p?: any) => {
    if (p) {
      setEditingId(p.id)
      setEditForm({ provider: p.provider, name: p.name, base_url: p.base_url || '', api_key: '', model: p.model || '' })
    } else {
      setEditingId('__new__')
      setEditForm({ provider: 'openai', name: '', base_url: '', api_key: '', model: 'gpt-4o' })
    }
  }

  const handleSave = async () => {
    try {
      await ipcInvoke(IPC_CHANNELS.AI_SAVE_PROVIDER, {
        id: editingId === '__new__' ? undefined : editingId,
        ...editForm,
        is_enabled: true,
      })
      setEditingId(null)
      setGlobalStatus('AI 配置已保存')
      await loadProviders()
    } catch (e: any) {
      setGlobalStatus(`AI 配置保存失败: ${e.message}`)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除此 AI 配置？')) return
    try {
      await ipcInvoke(IPC_CHANNELS.AI_DELETE_PROVIDER, id)
      setGlobalStatus('AI 配置已删除')
      await loadProviders()
    } catch (e: any) {
      setGlobalStatus(`删除失败: ${e.message}`)
    }
  }

  const handleTest = async (id: string): Promise<boolean> => {
    setTestingId(id)
    try {
      const result = await ipcInvoke<{ healthy: boolean; provider: string; model: string }>(
        IPC_CHANNELS.AI_TEST_PROVIDER, { provider_id: id }
      )
      const ok = result.healthy
      setGlobalStatus(ok ? `测试通过: ${result.provider} (${result.model})` : `测试失败: ${result.provider}`)
      return ok
    } catch (e: any) {
      setGlobalStatus(`测试失败: ${e.message}`)
      return false
    } finally {
      setTestingId(null)
    }
  }

  const handleSetActive = async (id: string) => {
    const ok = await handleTest(id)
    if (!ok) return
    setSettingActiveId(id)
    try {
      await ipcInvoke(IPC_CHANNELS.AI_SET_ACTIVE_PROVIDER, id)
      setGlobalStatus('已设为当前 AI 提供者')
      await loadProviders()
    } catch (e: any) {
      setGlobalStatus(`设置失败: ${e.message}`)
    } finally {
      setSettingActiveId(null)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* List existing providers */}
      {providers.map((p) => {
        const isActive = p.id === activeId
        return (
        <div
          key={p.id}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 12px', borderBottom: '1px solid var(--line)',
            borderRadius: 8,
            background: isActive ? 'rgba(47,101,217,0.06)' : undefined,
            border: isActive ? '1px solid rgba(47,101,217,0.3)' : undefined,
          }}
        >
          <div style={{ flex: 1 }}>
            <strong style={{ fontSize: 13, display: 'block' }}>
              {p.name} {isActive ? <span style={{ color: 'var(--blue)', fontSize: 11, marginLeft: 4 }}>● 当前使用中</span> : ''}
            </strong>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {p.provider} | {p.model} | {p.base_url || '默认地址'}
              {p.api_key_masked ? ` | API Key: ${p.api_key_masked}` : ''}
            </span>
            <span style={{ fontSize: 11, color: p.last_health_status === 'ok' ? 'var(--green)' : 'var(--muted)', marginLeft: 8 }}>
              {p.last_health_at ? `上次检测: ${new Date(p.last_health_at).toLocaleString('zh-CN')}` : '未检测'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              className={isActive ? 'primary-button' : 'icon-button'}
              style={{ fontSize: 12, opacity: settingActiveId === p.id ? 0.6 : 1 }}
              onClick={() => handleSetActive(p.id)}
              disabled={isActive || settingActiveId === p.id}
            >
              {isActive ? '当前使用中' : settingActiveId === p.id ? '设置中...' : '设为当前'}
            </button>
            <button
              className="icon-button"
              style={{ fontSize: 12, opacity: testingId === p.id ? 0.6 : 1 }}
              onClick={() => handleTest(p.id)}
              disabled={testingId === p.id}
            >
              {testingId === p.id ? '测试中...' : '测试连接'}
            </button>
            {p.id !== 'mock-default' && (
              <>
                <button className="icon-button" style={{ fontSize: 12 }} onClick={() => startEdit(p)}>编辑</button>
                <button className="icon-button" style={{ fontSize: 12, color: 'var(--red)' }} onClick={() => handleDelete(p.id)}>删除</button>
              </>
            )}
          </div>
        </div>
      )})}

      {/* Edit form */}
      {editingId ? (
        <div style={{ display: 'grid', gap: 10, padding: '12px 0', borderTop: '1px solid var(--line)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>提供商</label>
              <select
                value={editForm.provider}
                onChange={(e) => setEditForm({ ...editForm, provider: e.target.value })}
                style={{ width: '100%', height: 36, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px' }}
              >
                <option value="openai">OpenAI 兼容</option>
              </select>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>支持 OpenAI、DeepSeek、阿里云百炼等所有 OpenAI 格式 API</span>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>名称</label>
              <input
                placeholder="如: 我的 DeepSeek"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                style={{ width: '100%', height: 36, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px' }}
              />
            </div>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>Base URL</label>
            <input
              placeholder="https://api.deepseek.com/v1"
              value={editForm.base_url}
              onChange={(e) => setEditForm({ ...editForm, base_url: e.target.value })}
              style={{ width: '100%', height: 36, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px' }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>API Key</label>
              <input
                type="password"
                placeholder={editingId === '__new__' ? '输入 API Key' : '留空则不修改'}
                value={editForm.api_key}
                onChange={(e) => setEditForm({ ...editForm, api_key: e.target.value })}
                style={{ width: '100%', height: 36, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px' }}
              />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>API Key 将使用系统安全存储加密保存</span>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>模型</label>
              <input
                placeholder="gpt-4o / deepseek-chat"
                value={editForm.model}
                onChange={(e) => setEditForm({ ...editForm, model: e.target.value })}
                style={{ width: '100%', height: 36, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary-button" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </button>
            <button className="icon-button" onClick={() => setEditingId(null)}>取消</button>
          </div>
        </div>
      ) : (
        <button className="primary-button" onClick={() => startEdit()} disabled={saving}>
          添加 AI 配置
        </button>
      )}
    </div>
  )
}

// ── Data Source Status ─────────────────────────────────────────
type DataSourceStatus = 'connected' | 'failed' | 'unconfigured'

const STATUS_MAP: Record<DataSourceStatus, { label: string; className: string; color: string }> = {
  connected: { label: '已连接', className: 'status-dot', color: 'var(--green)' },
  failed: { label: '连接失败', className: 'status-dot warning', color: 'var(--orange)' },
  unconfigured: { label: '未配置', className: 'status-dot warning', color: 'var(--orange)' },
}

function DataSourceStatusPanel() {
  const [statuses, setStatuses] = useState<{
    market: DataSourceStatus
    news: DataSourceStatus
    ai: DataSourceStatus
  }>({ market: 'unconfigured', news: 'unconfigured', ai: 'unconfigured' })

  useEffect(() => {
    // Check data source statuses via IPC or store data availability
    async function checkStatus() {
      const result = { market: 'unconfigured' as DataSourceStatus, news: 'unconfigured' as DataSourceStatus, ai: 'unconfigured' as DataSourceStatus }

      try {
        // Check market data availability
        const quotes = await ipcInvoke('market:getQuotes').catch(() => null)
        result.market = quotes && Array.isArray(quotes) && quotes.length > 0 ? 'connected' : 'failed'
      } catch { result.market = 'failed' }

      try {
        // Check news data availability
        const news = await ipcInvoke('news:getList', {}).catch(() => null)
        result.news = news && Array.isArray(news) && news.length > 0 ? 'connected' : 'failed'
      } catch { result.news = 'failed' }

      try {
        // Check AI service availability
        const aiResp = await ipcInvoke('ai:chat', { message: 'ping' }).catch(() => null)
        result.ai = aiResp ? 'connected' : 'failed'
      } catch { result.ai = 'failed' }

      setStatuses(result)
    }

    checkStatus()
  }, [])

  return (
    <Panel title="数据源状态" subtitle="各数据源的连接状态检查">
      <div style={{ display: 'grid', gap: 12 }}>
        {[
          { key: 'market' as const, label: '行情数据源' },
          { key: 'news' as const, label: '舆情数据源' },
          { key: 'ai' as const, label: 'AI 服务' },
        ].map(({ key, label }) => {
          const s = STATUS_MAP[statuses[key]]
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 0',
                borderBottom: '1px solid var(--line)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className={s.className} style={{ background: s.color }} />
                <strong style={{ fontSize: 13 }}>{label}</strong>
              </div>
              <span
                style={{
                  fontSize: 12,
                  color: s.color,
                  fontWeight: 700,
                }}
              >
                {s.label}
              </span>
            </div>
          )
        })}
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
          {statuses.market === 'failed' && '行情数据源连接失败时，市场与K线页面将显示错误提示。'}
          {statuses.news === 'failed' && '舆情数据源连接失败时，舆情页面将显示错误提示。'}
          {statuses.ai === 'failed' && 'AI服务不可用时，AI助手页面将显示服务不可用提示。'}
        </p>
      </div>
    </Panel>
  )
}

// ── Settings Page ──────────────────────────────────────────────
export function SettingsPage() {
  const { settings, loading, error, fetchSettings, updateSettings } = useSettingsStore()
  const [localSettings, setLocalSettings] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  useEffect(() => { fetchSettings() }, [])

  useEffect(() => {
    if (settings) setLocalSettings({ ...settings })
  }, [settings])

  const handleChange = (key: keyof AppSettings, value: unknown) => {
    setLocalSettings((prev) => (prev ? { ...prev, [key]: value } : null))
  }

  const handleSave = async (partial: Partial<AppSettings>) => {
    setSaving(true)
    setSaveStatus(null)
    try {
      await updateSettings(partial)
      setSaveStatus('保存成功')
    } catch (e: any) {
      setSaveStatus(`保存失败: ${e.message || String(e)}`)
    } finally {
      setSaving(false)
      setTimeout(() => setSaveStatus(null), 3000)
    }
  }

  const handleBackup = async () => {
    try {
      // Export positions and trades as JSON backup
      const positions = await ipcInvoke<any[]>(IPC_CHANNELS.PORTFOLIO_GET_POSITIONS)
      const trades = await ipcInvoke<any[]>(IPC_CHANNELS.PORTFOLIO_GET_TRADES)
      const backup = JSON.stringify({ positions, trades, exported_at: new Date().toISOString() }, null, 2)
      await ipcInvoke(IPC_CHANNELS.APP_EXPORT_FILE, {
        defaultName: `riskpilot-backup-${new Date().toISOString().split('T')[0]}.json`,
        content: backup,
      })
      setSaveStatus('备份成功')
    } catch (e: any) {
      setSaveStatus(`备份失败: ${e.message || String(e)}`)
    }
    setTimeout(() => setSaveStatus(null), 3000)
  }

  const handleRestore = async () => {
    try {
      const filePath = await ipcInvoke<string>(IPC_CHANNELS.APP_OPEN_FILE)
      if (!filePath) {
        setSaveStatus('未选择文件')
        setTimeout(() => setSaveStatus(null), 3000)
        return
      }
      // Read file via app:readFile (this is a controlled operation available through main process)
      const content = await ipcInvoke<string>('settings:readFile', filePath)
      await ipcInvoke('settings:restoreBackup', { content })
      setSaveStatus('恢复成功，请刷新页面查看')
    } catch (e: any) {
      setSaveStatus(`恢复失败: ${e.message || String(e)}`)
    }
    setTimeout(() => setSaveStatus(null), 3000)
  }

  if (loading && !localSettings) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ display: 'grid', gap: 14 }}>
          <Skeleton height={180} />
          <Skeleton height={180} />
          <Skeleton height={180} />
        </div>
      </div>
    )
  }

  if (error && !localSettings) {
    return (
      <div className="alert-item severe" style={{ margin: 24 }}>
        <b>设置加载失败</b>
        <p>{error}</p>
        <button
          className="primary-button"
          onClick={fetchSettings}
          style={{ marginTop: 12 }}
        >
          重试
        </button>
      </div>
    )
  }

  if (!localSettings) return null

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {saveStatus && (
        <div
          className={`alert-item ${saveStatus.includes('失败') ? 'severe' : ''}`}
        >
          <b>{saveStatus}</b>
        </div>
      )}

      {/* Data Source Status */}
      <DataSourceStatusPanel />

      {/* Data Source Settings */}
      <Panel title="数据源" subtitle="配置行情数据与舆情数据来源">
        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <strong style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>行情数据源</strong>
            <MarketSourcePanel setGlobalStatus={setSaveStatus} />
          </div>

          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
            <strong style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>舆情数据源</strong>
            <NewsSourcePanel setGlobalStatus={setSaveStatus} />
          </div>

          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
            <strong style={{ display: 'block', marginBottom: 4 }}>
              数据刷新间隔
            </strong>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>
                当前: {Math.round((localSettings.data_refresh_interval_ms || 10000) / 1000)} 秒
              </span>
              <select
                value={localSettings.data_refresh_interval_ms}
                onChange={(e) => handleChange('data_refresh_interval_ms', Number(e.target.value))}
                style={{ height: 36, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px' }}
              >
                <option value={5000}>5秒</option>
                <option value={10000}>10秒</option>
                <option value={30000}>30秒</option>
                <option value={60000}>60秒</option>
              </select>
            </div>
          </div>

          <button
            className="primary-button"
            onClick={() => handleSave({ data_refresh_interval_ms: localSettings.data_refresh_interval_ms })}
            disabled={saving}
          >
            {saving ? '保存中...' : '保存数据源设置'}
          </button>
        </div>
      </Panel>

      {/* AI Model Settings */}
      <Panel title="AI模型" subtitle="选择AI服务提供商和模型">
        <AIProviderPanel saving={saving} setGlobalStatus={setSaveStatus} />
      </Panel>

      {/* Notification Settings */}
      <Panel title="通知" subtitle="预警通知与声音设置">
        <div style={{ display: 'grid', gap: 14 }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
            }}
          >
            <div>
              <strong style={{ display: 'block', marginBottom: 4 }}>
                启用通知
              </strong>
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>
                当触发预警时发送系统通知
              </span>
            </div>
            <input
              type="checkbox"
              checked={localSettings.notifications_enabled}
              onChange={(e) =>
                handleChange('notifications_enabled', e.target.checked)
              }
              style={{ width: 20, height: 20 }}
            />
          </label>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
            }}
          >
            <div>
              <strong style={{ display: 'block', marginBottom: 4 }}>
                声音提示
              </strong>
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>
                预警触发时播放提示音
              </span>
            </div>
            <input
              type="checkbox"
              checked={localSettings.sound_enabled}
              onChange={(e) =>
                handleChange('sound_enabled', e.target.checked)
              }
              style={{ width: 20, height: 20 }}
            />
          </label>
          <button
            className="primary-button"
            onClick={() =>
              handleSave({
                notifications_enabled:
                  localSettings.notifications_enabled,
                sound_enabled: localSettings.sound_enabled,
              })
            }
            disabled={saving}
          >
            {saving ? '保存中...' : '保存通知设置'}
          </button>
        </div>
      </Panel>

      {/* Security / Backup */}
      <Panel title="安全" subtitle="数据备份与恢复">
        <div style={{ display: 'flex', gap: 14 }}>
          <button className="primary-button" onClick={handleBackup}>
            备份数据
          </button>
          <button className="icon-button" onClick={handleRestore}>
            恢复数据
          </button>
        </div>
      </Panel>

      {/* Appearance */}
      <Panel title="外观" subtitle="切换主题模式">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <strong style={{ display: 'block', marginBottom: 4 }}>
              主题
            </strong>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>
              当前:{' '}
              {localSettings.theme === 'dark' ? '深色' : '浅色'}
            </span>
          </div>
          <button
            className="icon-button"
            onClick={() => {
              const newTheme =
                localSettings.theme === 'dark' ? 'light' : 'dark'
              handleChange('theme', newTheme)
              handleSave({ theme: newTheme })
            }}
          >
            {localSettings.theme === 'dark'
              ? '切换浅色模式'
              : '切换深色模式'}
          </button>
        </div>
      </Panel>

      {/* About */}
      <Panel title="关于" subtitle="RiskPilot 版本信息">
        <div
          style={{
            color: 'var(--muted)',
            fontSize: 13,
            lineHeight: 1.8,
          }}
        >
          <p>
            <strong style={{ color: 'var(--ink)' }}>RiskPilot</strong>{' '}
            股票基金智能风险管理终端
          </p>
          <p>版本: 0.1.0</p>
          <p>技术栈: Electron + React + TypeScript + ECharts</p>
          <p style={{ marginTop: 8, fontSize: 12 }}>
            本软件提供分析参考，不构成投资建议。投资有风险，入市需谨慎。
          </p>
        </div>
      </Panel>
    </div>
  )
}
