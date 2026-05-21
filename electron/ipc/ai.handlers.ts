import { v4 as uuid } from 'uuid'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { IpcChatPayload, IpcGenerateReportPayload, IpcSaveProviderPayload, IpcTestProviderPayload } from '../../shared/types/ipc'
import type { AIChatContext, RiskSummary, AIChatMessage } from '../../shared/types/database'
import { getDb } from '../db'
import { AIService } from '../services/ai.service'
import { getPositionService } from '../services/portfolio'
import { RiskService } from '../services/risk.service'
import { NewsService } from '../services/news.service'
import { ReportService } from '../services/report.service'
import { getActiveAI, getModelName, getAIProviders, getAIProviderById, saveAIProvider, deleteAIProvider, setActiveAIProvider, refreshAICache } from '../services/ai-providers/registry'
import { createIpcHandler } from './create-handler'

const legacyAiService = new AIService()
const riskService = new RiskService()
const newsService = new NewsService()

function buildAIContext(): AIChatContext {
  const positions = getPositionService().getPositionsWithDetails()
  const summary = getPositionService().getSummary()
  const riskMetrics = riskService.getSummary()
  const newsResult = newsService.getNews({ limit: 30 })

  return {
    portfolio_summary: summary,
    risk_metrics: riskMetrics,
    positions,
    latest_news: newsResult.items
  }
}

export function registerAiHandlers(): void {
  // ---- AI Chat (uses active provider) ----
  createIpcHandler(IPC_CHANNELS.AI_CHAT, async (_event, payload: IpcChatPayload) => {
    const context = payload.context || buildAIContext()
    const provider = getActiveAI()

    let content: string
    if (provider.id === 'mock-ai') {
      // Use legacy mock chat that returns structured responses
      const msg = legacyAiService.chat(payload.message, context)
      content = msg.content
    } else {
      content = await provider.chat(payload.message, context)
    }

    const message: AIChatMessage = {
      id: uuid(),
      role: 'assistant',
      content,
      timestamp: new Date().toISOString(),
      type: 'chat',
    }
    return message
  })

  // ---- Summarize news ----
  createIpcHandler(IPC_CHANNELS.AI_SUMMARIZE_NEWS, async (_event, newsIds: string[]) => {
    const provider = getActiveAI()
    if (provider.id === 'mock-ai') {
      const msg = legacyAiService.summarizeNews(newsIds || [])
      return msg
    }
    // For real AI, build prompt from news
    const context = buildAIContext()
    const prompt = `请用中文总结以下 ${newsIds.length} 条新闻的核心要点，给出整体情感倾向和关键信息。`
    const content = await provider.chat(prompt, context)
    return { id: uuid(), role: 'assistant', content, timestamp: new Date().toISOString(), type: 'summary' }
  })

  // ---- Explain risk ----
  createIpcHandler(IPC_CHANNELS.AI_EXPLAIN_RISK, async (_event, riskData?: RiskSummary) => {
    const metrics = riskData || riskService.getSummary()
    const provider = getActiveAI()
    if (provider.id === 'mock-ai') {
      const msg = legacyAiService.explainRisk(metrics)
      return msg
    }
    const context = buildAIContext()
    const prompt = `请解读以下风险指标：风险评分${metrics.risk_score}分(${metrics.risk_level})，波动率${(metrics.volatility*100).toFixed(2)}%，最大回撤${(metrics.max_drawdown*100).toFixed(2)}%，夏普比率${metrics.sharpe_ratio.toFixed(2)}，Beta${metrics.beta.toFixed(2)}，VaR(95%)¥${metrics.var_95.toLocaleString('zh-CN')}。`
    const content = await provider.chat(prompt, context)
    return { id: uuid(), role: 'assistant', content, timestamp: new Date().toISOString(), type: 'risk_explanation' }
  })

  // ---- Generate report (single-pass) ----
  createIpcHandler(IPC_CHANNELS.AI_GENERATE_REPORT, async (_event, payload: IpcGenerateReportPayload) => {
    const provider = getActiveAI()
    let content: string
    if (provider.id === 'mock-ai') {
      const msg = legacyAiService.generateReport(payload.report_type, payload.params)
      content = msg.content
    } else {
      const context = buildAIContext()
      const prompt = `请用中文生成一份${payload.report_type}类型的风险管理报告，包含资产概览、业绩表现、风险变化和观察清单。`
      content = await provider.chat(prompt, context)
    }

    // Single-pass persist: pass pre-generated content directly
    const reportService = new ReportService()
    const report = reportService.generateReport(payload.report_type, payload.params, content)

    const message: AIChatMessage = {
      id: uuid(),
      role: 'assistant',
      content,
      timestamp: new Date().toISOString(),
      type: 'report',
    }
    return { message, report_id: report.id }
  })

  // ---- Provider management ----
  createIpcHandler(IPC_CHANNELS.AI_GET_PROVIDERS, async () => {
    return getAIProviders()
  })

  createIpcHandler(IPC_CHANNELS.AI_SAVE_PROVIDER, async (_event, payload: IpcSaveProviderPayload) => {
    const id = saveAIProvider(payload)
    return { id }
  })

  createIpcHandler(IPC_CHANNELS.AI_DELETE_PROVIDER, async (_event, providerId: string) => {
    deleteAIProvider(providerId)
    return null
  })

  createIpcHandler(IPC_CHANNELS.AI_TEST_PROVIDER, async (_event, payload: IpcTestProviderPayload) => {
    refreshAICache()
    const provider = getAIProviderById(payload.provider_id)
    if (!provider) {
      throw new Error(`未找到 AI 提供者: ${payload.provider_id}`)
    }
    const healthy = await provider.healthCheck()
    return { healthy, provider: provider.name, model: provider.model }
  })

  createIpcHandler(IPC_CHANNELS.AI_SET_ACTIVE_PROVIDER, async (_event, providerId: string) => {
    setActiveAIProvider(providerId)
    return null
  })

  createIpcHandler(IPC_CHANNELS.AI_GET_PROVIDER_STATUS, async () => {
    const providers = getAIProviders()
    const active = getActiveAI()
    return {
      providers,
      active_id: active.id,
      active_name: active.name,
      model: active.model,
      is_mock: active.id === 'mock-ai',
    }
  })
}
