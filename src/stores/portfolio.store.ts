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
  /** Generic fallback loading/error (kept for backward compat) */
  loading: boolean
  error: string | null
  /** Per-action loading states */
  portfolioRefreshing: boolean
  tradeSaving: boolean
  importing: boolean
  /** Per-action error states */
  positionsError: string | null
  tradesError: string | null
  summaryError: string | null
  tradeSaveError: string | null
  importError: string | null
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
  portfolioRefreshing: false,
  tradeSaving: false,
  importing: false,
  positionsError: null,
  tradesError: null,
  summaryError: null,
  tradeSaveError: null,
  importError: null,

  fetchPositions: async () => {
    set({ portfolioRefreshing: true, positionsError: null })
    try {
      const result = await ipcInvoke<PositionWithAsset[]>(IPC_CHANNELS.PORTFOLIO_GET_POSITIONS)
      set({ positions: result, portfolioRefreshing: false, loading: false })
    } catch (e: any) {
      set({ positionsError: e.message || '持仓数据加载失败', portfolioRefreshing: false, loading: false, error: e.message || '持仓数据加载失败' })
    }
  },

  fetchTrades: async () => {
    set({ portfolioRefreshing: true, tradesError: null })
    try {
      const result = await ipcInvoke<Trade[]>(IPC_CHANNELS.PORTFOLIO_GET_TRADES)
      set({ trades: result, portfolioRefreshing: false, loading: false })
    } catch (e: any) {
      set({ tradesError: e.message || '交易记录加载失败', portfolioRefreshing: false, loading: false, error: e.message || '交易记录加载失败' })
    }
  },

  fetchSummary: async () => {
    set({ portfolioRefreshing: true, summaryError: null })
    try {
      const result = await ipcInvoke<PortfolioSummary>(IPC_CHANNELS.PORTFOLIO_GET_SUMMARY)
      set({ summary: result, portfolioRefreshing: false, loading: false })
    } catch (e: any) {
      set({ summaryError: e.message || '资产概览加载失败', portfolioRefreshing: false, loading: false, error: e.message || '资产概览加载失败' })
    }
  },

  addTrade: async (payload) => {
    set({ tradeSaving: true, tradeSaveError: null })
    try {
      await ipcInvoke(IPC_CHANNELS.PORTFOLIO_ADD_TRADE, payload)
      set({ tradeSaving: false, loading: false })
    } catch (e: any) {
      set({ tradeSaveError: e.message || '添加股票失败', tradeSaving: false, loading: false, error: e.message || '添加股票失败' })
    }
  },

  addFundPurchase: async (payload) => {
    set({ tradeSaving: true, tradeSaveError: null })
    try {
      await ipcInvoke(IPC_CHANNELS.PORTFOLIO_ADD_FUND_PURCHASE, payload)
      set({ tradeSaving: false, loading: false })
    } catch (e: any) {
      set({ tradeSaveError: e.message || '添加基金持仓失败', tradeSaving: false, loading: false, error: e.message || '添加基金持仓失败' })
      throw e
    }
  },

  updateTrade: async (tradeId, updates) => {
    set({ tradeSaving: true, tradeSaveError: null })
    try {
      await ipcInvoke(IPC_CHANNELS.PORTFOLIO_UPDATE_TRADE, { tradeId, updates })
      set({ tradeSaving: false, loading: false })
    } catch (e: any) {
      set({ tradeSaveError: e.message || '更新交易失败', tradeSaving: false, loading: false, error: e.message || '更新交易失败' })
      throw e
    }
  },

  voidTrade: async (tradeId) => {
    set({ tradeSaving: true, tradeSaveError: null })
    try {
      await ipcInvoke(IPC_CHANNELS.PORTFOLIO_VOID_TRADE, tradeId)
      const positions = await ipcInvoke<PositionWithAsset[]>(IPC_CHANNELS.PORTFOLIO_GET_POSITIONS)
      const summary = await ipcInvoke<PortfolioSummary>(IPC_CHANNELS.PORTFOLIO_GET_SUMMARY)
      set({ positions, summary, tradeSaving: false, loading: false })
    } catch (e: any) {
      set({ tradeSaveError: e.message || '作废交易失败', tradeSaving: false, loading: false, error: e.message || '作废交易失败' })
    }
  },

  importCSV: async (payload) => {
    set({ importing: true, importError: null })
    try {
      const result = await ipcInvoke<IpcImportCsvResult>(IPC_CHANNELS.PORTFOLIO_IMPORT_CSV, payload)
      set({ importing: false, loading: false })
      return result
    } catch (e: any) {
      set({ importError: e.message || 'CSV 导入失败', importing: false, loading: false, error: e.message || 'CSV 导入失败' })
    }
  },

  exportCSV: async (type) => {
    set({ tradeSaving: true, tradeSaveError: null })
    try {
      const result = await ipcInvoke<string>(IPC_CHANNELS.PORTFOLIO_EXPORT_CSV, type)
      set({ tradeSaving: false, loading: false })
      return result
    } catch (e: any) {
      set({ tradeSaveError: e.message || 'CSV 导出失败', tradeSaving: false, loading: false, error: e.message || 'CSV 导出失败' })
    }
  },
}))
