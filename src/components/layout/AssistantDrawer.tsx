import { useState } from 'react'
import { useAIStore } from '@/stores/ai.store'
import { useAppStore } from '@/stores/app.store'
import { useRiskStore } from '@/stores/risk.store'
import { useNewsStore } from '@/stores/news.store'

export function AssistantDrawer() {
  const messages = useAIStore((s) => s.messages)
  const sendMessage = useAIStore((s) => s.sendMessage)
  const aiLoading = useAIStore((s) => s.loading)
  const toggleDrawer = useAppStore((s) => s.toggleDrawer)
  const dataSourceStatus = useAppStore((s) => s.dataSourceStatus)

  const riskSummary = useRiskStore((s) => s.summary)
  const riskLoading = useRiskStore((s) => s.loading)

  const newsItems = useNewsStore((s) => s.items)
  const newsLoading = useNewsStore((s) => s.loading)

  const isAIReal = dataSourceStatus?.is_ai_real ?? false

  const [input, setInput] = useState('')

  const riskScore = riskSummary?.risk_score
  const riskLevel = riskSummary?.risk_level ?? 'medium'

  const riskLevelText: Record<string, string> = {
    low: '较低',
    medium: '中等',
    high: '偏高',
    critical: '极高',
  }

  const prompts = [
    { label: '为什么今天上涨', text: '请分析今天持仓组合上涨的原因' },
    { label: '解释风险分', text: '请解释我的组合风险评分' },
    { label: '生成周报', text: '请生成本周的持仓风险周报' },
    { label: '压力测试', text: '请对我的组合运行压力测试' },
  ]

  const handleSend = () => {
    const text = input.trim()
    if (!text || aiLoading) return
    sendMessage(text)
    setInput('')
  }

  const handlePromptClick = (promptText: string) => {
    if (aiLoading) return
    sendMessage(promptText)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSend()
  }

  const recentMessages = messages.slice(-4)

  return (
    <aside className="assistant-drawer">
      <div className="drawer-header">
        <div>
          <h2>AI 助手</h2>
          <span>
            {isAIReal
              ? `已接入 · ${dataSourceStatus?.ai_model ?? ''}`
              : '本地模拟 · 未接入大模型'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span
            className="assistant-status"
            style={isAIReal ? {} : { background: '#fff3d9', color: 'var(--orange)' }}
          >
            {isAIReal ? '在线' : '演示'}
          </span>
          <button className="text-button" onClick={toggleDrawer} title="关闭助手">
            ✕
          </button>
        </div>
      </div>

      <div className="ai-summary">
        <h3>AI 市场概要</h3>
        {riskLoading && !riskSummary ? (
          <div>
            <div className="skeleton" style={{ height: 14, borderRadius: 4, marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 14, borderRadius: 4, width: '80%' }} />
          </div>
        ) : riskSummary ? (
          <p>
            今日市场整体震荡，您的持仓组合风险评分为
            <b style={{ color: 'var(--orange)' }}>{riskScore}</b>
            ，处于{riskLevelText[riskLevel]}水平。
            {riskLevel === 'high' || riskLevel === 'critical'
              ? '建议关注集中度风险并适当分散配置。'
              : '组合整体风险可控，建议持续关注市场变化。'}
          </p>
        ) : (
          <p style={{ color: 'var(--muted)' }}>
            AI 市场概要暂不可用，请先加载持仓与风险数据。
          </p>
        )}
      </div>

      <div className="prompt-chips">
        {prompts.map((p) => (
          <button key={p.label} onClick={() => handlePromptClick(p.text)} disabled={aiLoading}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="news-feed">
        <b className="feed-title">最新资讯</b>
        {newsLoading && newsItems.length === 0 ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 48, borderRadius: 8, marginTop: i > 0 ? 12 : 0 }} />
          ))
        ) : newsItems.length > 0 ? (
          newsItems.slice(0, 3).map((item) => (
            <article key={item.id}>
              <span className={`tag ${item.importance === 'high' ? 'danger' : item.importance === 'medium' ? 'warning' : ''}`}>
                {item.importance === 'high' ? '重要' : item.importance === 'medium' ? '一般' : '资讯'}
              </span>
              <b>{item.title}</b>
              <p>{new Date(item.published_at).toLocaleString('zh-CN')}</p>
            </article>
          ))
        ) : (
          <div style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', padding: 12 }}>
            暂无最新资讯
          </div>
        )}
        {/* AI conversation below news */}
        {recentMessages.length > 0 && (
          <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <b style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>AI 对话记录</b>
            {recentMessages.map((msg) => (
              <article key={msg.id}>
                <span className={`tag ${msg.role === 'user' ? 'ok' : 'warning'}`}>
                  {msg.role === 'user' ? '我' : 'AI'}
                </span>
                <b>{msg.content.slice(0, 60)}{msg.content.length > 60 ? '...' : ''}</b>
                <p>{new Date(msg.timestamp).toLocaleTimeString('zh-CN')}</p>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="chat-box">
        <input
          type="text"
          placeholder="向AI助手提问..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={aiLoading}
        />
        <button onClick={handleSend} disabled={aiLoading || !input.trim()}>
          {aiLoading ? '...' : '发送'}
        </button>
      </div>
    </aside>
  )
}
