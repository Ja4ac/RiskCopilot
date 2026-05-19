import { create } from 'zustand'
import { ipcInvoke } from '@/hooks/useIPC'
import { IPC_CHANNELS } from '@/types'
import type {
  PositionWithAsset,
  PortfolioSummary,
  Trade,
  IpcAddTradePayload,
  IpcImportCsvResult,
  IpcAddFundPurchasePayload,
} from '@/types'

interface PortfolioState {
  positions: PositionWithAsset[]
  trades: Trade[]
  summary: PortfolioSummary | null
  loading: boolean
  error: string | null
  fetchPositions: () => Promise<void>
  fetchTrades: () => Promise<void>
  fetchSummary: () => Promise<void>
  addTrade: (payload: IpcAddTradePayload) => Promise<void>
  addFundPurchase: (payload: IpcAddFundPurchasePayload) => Promise<void>
  updateTrade: (tradeId: string, updates: Partial<IpcAddTradePayload>) => Promise<void>
  voidTrade: (tradeId: string) => Promise<void>
  importCSV: (payload: { csvContent: string; accountId: string }) => Promise<IpcImportCsvResult | void>
  exportCSV: (type: 'positions' | 'trades') => Promise<string | void>
}

export const usePortfolioStore = create<PortfolioState>((set) => ({
  positions: [],
  trades: [],
  summary: null,
  loading: false,
  error: null,

  fetchPositions: async () => {
    set({ loading: true, error: null })
    try {
      const result = await ipcInvoke<PositionWithAsset[]>(
        IPC_CHANNELS.PORTFOLIO_GET_POSITIONS
      )
      set({ positions: result, loading: false })
    } catch (e: any) {
      set({ error: e.message || '持仓数据加载失败', loading: false })
    }
  },

  fetchTrades: async () => {
    set({ loading: true, error: null })
    try {
      const result = await ipcInvoke<Trade[]>(
        IPC_CHANNELS.PORTFOLIO_GET_TRADES
      )
      set({ trades: result, loading: false })
    } catch (e: any) {
      set({ error: e.message || '交易记录加载失败', loading: false })
    }
  },

  fetchSummary: async () => {
    set({ loading: true, error: null })
    try {
      const result = await ipcInvoke<PortfolioSummary>(
        IPC_CHANNELS.PORTFOLIO_GET_SUMMARY
      )
      set({ summary: result, loading: false })
    } catch (e: any) {
      set({ error: e.message || '资产概览加载失败', loading: false })
    }
  },

  addTrade: async (payload) => {
    set({ loading: true, error: null })
    try {
      await ipcInvoke(IPC_CHANNELS.PORTFOLIO_ADD_TRADE, payload)
      set({ loading: false })
    } catch (e: any) {
      set({ error: e.message || '添加交易失败', loading: false })
    }
  },

  addFundPurchase: async (payload) => {
    set({ loading: true, error: null })
    try {
      await ipcInvoke(IPC_CHANNELS.PORTFOLIO_ADD_FUND_PURCHASE, payload)
      set({ loading: false })
    } catch (e: any) {
      set({ error: e.message || '添加基金持仓失败', loading: false })
      throw e // Re-throw so caller can show error message
    }
  },

  updateTrade: async (tradeId, updates) => {
    set({ loading: true, error: null })
    try {
      await ipcInvoke(IPC_CHANNELS.PORTFOLIO_UPDATE_TRADE, { tradeId, updates })
      set({ loading: false })
    } catch (e: any) {
      set({ error: e.message || '更新交易失败', loading: false })
      throw e
    }
  },

  voidTrade: async (tradeId) => {
    set({ loading: true, error: null })
    try {
      await ipcInvoke(IPC_CHANNELS.PORTFOLIO_VOID_TRADE, tradeId)
      // Refresh positions after voiding
      const positions = await ipcInvoke<PositionWithAsset[]>(IPC_CHANNELS.PORTFOLIO_GET_POSITIONS)
      const summary = await ipcInvoke<PortfolioSummary>(IPC_CHANNELS.PORTFOLIO_GET_SUMMARY)
      set({ positions, summary, loading: false })
    } catch (e: any) {
      set({ error: e.message || '作废交易失败', loading: false })
    }
  },

  importCSV: async (payload) => {
    set({ loading: true, error: null })
    try {
      const result = await ipcInvoke<IpcImportCsvResult>(
        IPC_CHANNELS.PORTFOLIO_IMPORT_CSV,
        payload
      )
      set({ loading: false })
      return result
    } catch (e: any) {
      set({ error: e.message || 'CSV 导入失败', loading: false })
    }
  },

  exportCSV: async (type) => {
    set({ loading: true, error: null })
    try {
      const result = await ipcInvoke<string>(
        IPC_CHANNELS.PORTFOLIO_EXPORT_CSV,
        type
      )
      set({ loading: false })
      return result
    } catch (e: any) {
      set({ error: e.message || 'CSV 导出失败', loading: false })
    }
  },
}))
