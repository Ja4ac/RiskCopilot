import { ipcMain } from 'electron'
import { v4 as uuid } from 'uuid'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { IpcChatPayload, IpcGenerateReportPayload, IpcSaveProviderPayload, IpcTestProviderPayload } from '../../shared/types/ipc'
import type { AIChatContext, RiskSummary, AIChatMessage } from '../../shared/types/database'
import { getDb } from '../db'
import { AIService } from '../services/ai.service'
import { PortfolioService } from '../services/portfolio.service'
import { RiskService } from '../services/risk.service'
import { NewsService } from '../services/news.service'
import { ReportService } from '../services/report.service'
import { getActiveAI, getModelName, getAIProviders, getAIProviderById, saveAIProvider, deleteAIProvider, setActiveAIProvider, refreshAICache } from '../services/ai-providers/registry'

const legacyAiService = new AIService()
const portfolioService = new PortfolioService()
const riskService = new RiskService()
const newsService = new NewsService()

function buildAIContext(): AIChatContext {
  const positions = portfolioService.getPositionsWithDetails()
  const summary = portfolioService.getSummary()
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
  ipcMain.handle(IPC_CHANNELS.AI_CHAT, async (_event, payload: IpcChatPayload) => {
    try {
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
      return { success: true, data: message }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ---- Summarize news ----
  ipcMain.handle(IPC_CHANNELS.AI_SUMMARIZE_NEWS, async (_event, newsIds: string[]) => {
    try {
      const provider = getActiveAI()
      if (provider.id === 'mock-ai') {
        const msg = legacyAiService.summarizeNews(newsIds || [])
        return { success: true, data: msg }
      }
      // For real AI, build prompt from news
      const context = buildAIContext()
      const prompt = `请用中文总结以下 ${newsIds.length} 条新闻的核心要点，给出整体情感倾向和关键信息。`
      const content = await provider.chat(prompt, context)
      return { success: true, data: { id: uuid(), role: 'assistant', content, timestamp: new Date().toISOString(), type: 'summary' } }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ---- Explain risk ----
  ipcMain.handle(IPC_CHANNELS.AI_EXPLAIN_RISK, async (_event, riskData?: RiskSummary) => {
    try {
      const metrics = riskData || riskService.getSummary()
      const provider = getActiveAI()
      if (provider.id === 'mock-ai') {
        const msg = legacyAiService.explainRisk(metrics)
        return { success: true, data: msg }
      }
      const context = buildAIContext()
      const prompt = `请解读以下风险指标：风险评分${metrics.risk_score}分(${metrics.risk_level})，波动率${(metrics.volatility*100).toFixed(2)}%，最大回撤${(metrics.max_drawdown*100).toFixed(2)}%，夏普比率${metrics.sharpe_ratio.toFixed(2)}，Beta${metrics.beta.toFixed(2)}，VaR(95%)¥${metrics.var_95.toLocaleString('zh-CN')}。`
      const content = await provider.chat(prompt, context)
      return { success: true, data: { id: uuid(), role: 'assistant', content, timestamp: new Date().toISOString(), type: 'risk_explanation' } }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ---- Generate report (single-pass) ----
  ipcMain.handle(IPC_CHANNELS.AI_GENERATE_REPORT, async (_event, payload: IpcGenerateReportPayload) => {
    try {
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
      return { success: true, data: { message, report_id: report.id } }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ---- Provider management ----
  ipcMain.handle(IPC_CHANNELS.AI_GET_PROVIDERS, async () => {
    try {
      const providers = getAIProviders()
      return { success: true, data: providers }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_SAVE_PROVIDER, async (_event, payload: IpcSaveProviderPayload) => {
    try {
      const id = saveAIProvider(payload)
      return { success: true, data: { id } }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_DELETE_PROVIDER, async (_event, providerId: string) => {
    try {
      deleteAIProvider(providerId)
      return { success: true, data: null }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_TEST_PROVIDER, async (_event, payload: IpcTestProviderPayload) => {
    try {
      refreshAICache()
      const provider = getAIProviderById(payload.provider_id)
      if (!provider) {
        return { success: false, error: `未找到 AI 提供者: ${payload.provider_id}` }
      }
      const healthy = await provider.healthCheck()
      return { success: true, data: { healthy, provider: provider.name, model: provider.model } }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_SET_ACTIVE_PROVIDER, async (_event, providerId: string) => {
    try {
      setActiveAIProvider(providerId)
      return { success: true, data: null }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_GET_PROVIDER_STATUS, async () => {
    try {
      const providers = getAIProviders()
      const active = getActiveAI()
      return {
        success: true,
        data: {
          providers,
          active_id: active.id,
          active_name: active.name,
          model: active.model,
          is_mock: active.id === 'mock-ai',
        }
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
}
