import { useState, useRef, useEffect } from 'react'
import { useAIStore } from '@/stores/ai.store'
import { ipcInvoke } from '@/hooks/useIPC'
import { IPC_CHANNELS } from '@/types'
import { Panel } from '@/components/ui/Panel'

export function AIAssistantPage() {
  const { messages, loading, error, sendMessage, clearHistory } = useAIStore()
  const [input, setInput] = useState('')
  const [generating, setGenerating] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = () => {
    const text = input.trim()
    if (!text || loading) return
    sendMessage(text)
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleChipClick = (prompt: string) => {
    if (loading) return
    sendMessage(prompt)
  }

  // Generate report via AI
  const handleGenerateReport = async (type: string = 'daily') => {
    setGenerating(true)
    try {
      await ipcInvoke(IPC_CHANNELS.AI_GENERATE_REPORT, { report_type: type })
      await sendMessage(`请为我生成一份${type === 'daily' ? '日报' : type === 'weekly' ? '周报' : type === 'monthly' ? '月报' : '风险评估报告'}`)
    } catch (e: any) {
      // Error is handled by the store
    } finally {
      setGenerating(false)
    }
  }

  // Summarize recent news
  const handleSummarizeNews = async () => {
    setSummarizing(true)
    try {
      await ipcInvoke(IPC_CHANNELS.AI_SUMMARIZE_NEWS, [])
      await sendMessage('请概括最新的舆情要点')
    } catch (e: any) {
      // Error handled by store
    } finally {
      setSummarizing(false)
    }
  }

  const promptChips = [
    '分析我的组合风险',
    '最近的舆情有哪些风险点',
    '生成今日投资快报',
    '解释我的持仓相关度',
  ]

  return (
    <div>
      <Panel
        title="AI 智能助手"
        subtitle="已接入持仓上下文 · 支持多轮对话"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="text-button"
              onClick={handleSummarizeNews}
              disabled={summarizing || loading}
            >
              {summarizing ? '概括中...' : '概括舆情'}
            </button>
            <button
              className="text-button"
              onClick={() => handleGenerateReport('daily')}
              disabled={generating || loading}
            >
              {generating ? '生成中...' : '生成报告'}
            </button>
            <button
              className="text-button"
              onClick={clearHistory}
              disabled={loading}
            >
              清空历史
            </button>
          </div>
        }
      >
        {/* Prompt chips */}
        <div
          style={{
            display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap',
          }}
        >
          {promptChips.map((p) => (
            <button
              key={p}
              className="text-button"
              onClick={() => handleChipClick(p)}
              disabled={loading}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Chat area */}
        <div
          style={{
            maxHeight: 500, overflowY: 'auto', padding: 16,
            border: '1px solid var(--line)', borderRadius: 10,
            background: 'var(--surface-soft)',
          }}
        >
          {/* Error display */}
          {error && (
            <div className="alert-item severe" style={{ marginBottom: 14 }}>
              <b>AI服务暂时不可用</b>
              <p>{error}</p>
              <button
                className="text-button"
                onClick={() => {
                  if (input.trim()) handleSend()
                }}
                style={{ marginTop: 6 }}
              >
                重试
              </button>
            </div>
          )}

          {/* Empty state */}
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 40 }}>
              <p style={{ fontSize: 16, marginBottom: 8 }}>RiskPilot AI 助手</p>
              <p style={{ fontSize: 13 }}>
                我可以帮您分析持仓风险、解读市场动态、生成投资报告
              </p>
            </div>
          )}

          {/* Messages */}
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                marginBottom: 16,
                alignItems: 'flex-start',
                gap: 8,
              }}
            >
              {/* Avatar */}
              <div
                style={{
                  minWidth: 32, height: 32, borderRadius: '50%',
                  display: 'grid', placeItems: 'center',
                  background: msg.role === 'user' ? '#2f65d9' : '#078f8c',
                  color: '#fff', fontSize: 12, fontWeight: 800,
                  flexShrink: 0,
                }}
              >
                {msg.role === 'user' ? '我' : 'AI'}
              </div>
              {/* Bubble */}
              <div
                style={{
                  maxWidth: '70%',
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: msg.role === 'user' ? '#eef6ff' : '#ffffff',
                  border: '1px solid var(--line)',
                  borderTopRightRadius: msg.role === 'user' ? 4 : 12,
                  borderTopLeftRadius: msg.role === 'assistant' ? 4 : 12,
                }}
              >
                <div
                  style={{
                    fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {msg.content}
                </div>
                <div
                  style={{
                    fontSize: 11, color: 'var(--muted)', marginTop: 6,
                  }}
                >
                  {new Date(msg.timestamp).toLocaleTimeString('zh-CN')}
                  {msg.type && (
                    <span style={{ marginLeft: 8 }}>
                      ·{' '}
                      {msg.type === 'chat'
                        ? '对话'
                        : msg.type === 'summary'
                          ? '摘要'
                          : msg.type === 'risk_explanation'
                            ? '风险解释'
                            : '报告'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {loading && (
            <div
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 16,
              }}
            >
              <div
                style={{
                  minWidth: 32, height: 32, borderRadius: '50%',
                  display: 'grid', placeItems: 'center',
                  background: '#078f8c', color: '#fff',
                  fontSize: 12, fontWeight: 800,
                }}
              >
                AI
              </div>
              <div
                style={{
                  padding: '10px 14px', borderRadius: 12, background: '#ffffff',
                  border: '1px solid var(--line)', borderTopLeftRadius: 4,
                  color: 'var(--muted)', fontSize: 13,
                }}
              >
                AI 正在思考...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <input
            type="text"
            placeholder="输入您的问题，按 Enter 发送..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            style={{
              flex: 1, height: 42, border: '1px solid var(--line)',
              borderRadius: 8, padding: '0 14px', fontSize: 14,
              background: 'var(--surface)',
            }}
          />
          <button
            className="primary-button"
            onClick={handleSend}
            disabled={loading || !input.trim()}
          >
            {loading ? '发送中...' : '发送'}
          </button>
        </div>

        {/* Disclaimer */}
        <p
          style={{
            marginTop: 12, fontSize: 12, color: 'var(--muted)',
            textAlign: 'center',
          }}
        >
          AI 内容仅供参考，不构成投资建议。请结合自身情况独立判断。
        </p>
      </Panel>
    </div>
  )
}
