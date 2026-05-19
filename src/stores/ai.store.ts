import { create } from 'zustand'
import { ipcInvoke } from '@/hooks/useIPC'
import { IPC_CHANNELS } from '@/types'
import type {
  AIChatMessage,
  Report,
  ReportType,
  IpcChatPayload,
  IpcGenerateReportPayload,
} from '@/types'

interface AIState {
  messages: AIChatMessage[]
  summary: string
  loading: boolean
  error: string | null
  sendMessage: (text: string) => Promise<void>
  summarizeNews: (newsIds: string[]) => Promise<void>
  explainRisk: () => Promise<void>
  generateReport: (reportType: ReportType) => Promise<void>
  clearHistory: () => void
}

let msgCounter = 0

export const useAIStore = create<AIState>((set, get) => ({
  messages: [
    {
      id: 'init-1',
      role: 'assistant',
      content:
        '您好！我是 RiskPilot AI 助手。\n\n⚠️ 当前使用本地模拟引擎，未接入真实大模型。回复内容基于预置规则生成，仅供参考。\n\n请在「系统设置」中配置 AI 服务商和 API 密钥以启用真正的 AI 分析能力。\n\n我可以帮您：分析持仓风险、解读市场动态、生成投资报告。请问有什么可以帮您的？',
      timestamp: new Date().toISOString(),
      type: 'chat',
    },
  ],
  summary: '',
  loading: false,
  error: null,

  sendMessage: async (text) => {
    const userMsg: AIChatMessage = {
      id: `msg-${++msgCounter}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    }
    set((s) => ({
      messages: [...s.messages, userMsg],
      loading: true,
      error: null,
    }))

    try {
      const payload: IpcChatPayload = { message: text }
      const result = await ipcInvoke<AIChatMessage>(
        IPC_CHANNELS.AI_CHAT,
        payload
      )
      set((s) => ({
        messages: [...s.messages, result],
        loading: false,
      }))
    } catch (e: any) {
      const errMsg: AIChatMessage = {
        id: `msg-${++msgCounter}`,
        role: 'assistant',
        content: `抱歉，AI 服务暂时不可用：${e.message || '请稍后重试'}`,
        timestamp: new Date().toISOString(),
      }
      set((s) => ({
        messages: [...s.messages, errMsg],
        loading: false,
        error: e.message || 'AI 对话失败',
      }))
    }
  },

  summarizeNews: async (newsIds) => {
    set({ loading: true, error: null })
    try {
      const payload = newsIds
      const result = await ipcInvoke<string>(
        IPC_CHANNELS.AI_SUMMARIZE_NEWS,
        payload
      )
      set({ summary: result, loading: false })
    } catch (e: any) {
      set({ error: e.message || '新闻摘要生成失败', loading: false })
    }
  },

  explainRisk: async () => {
    set({ loading: true, error: null })
    try {
      const result = await ipcInvoke<string>(
        IPC_CHANNELS.AI_EXPLAIN_RISK
      )
      set({ summary: result, loading: false })
    } catch (e: any) {
      set({ error: e.message || '风险解读生成失败', loading: false })
    }
  },

  generateReport: async (reportType) => {
    set({ loading: true, error: null })
    try {
      const payload: IpcGenerateReportPayload = { report_type: reportType }
      await ipcInvoke<Report>(
        IPC_CHANNELS.AI_GENERATE_REPORT,
        payload
      )
      set({ loading: false })
    } catch (e: any) {
      set({ error: e.message || '报告生成失败', loading: false })
    }
  },

  clearHistory: () =>
    set({
      messages: [
        {
          id: 'init-1',
          role: 'assistant',
          content:
            '您好！我是 RiskPilot AI 助手。历史已清空，有什么可以帮您的？',
          timestamp: new Date().toISOString(),
          type: 'chat',
        },
      ],
    }),
}))
