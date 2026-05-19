import { create } from 'zustand'
import { ipcInvoke } from '@/hooks/useIPC'
import { IPC_CHANNELS } from '@/types'
import type {
  MarketQuote,
  KlineBar,
  KlinePeriod,
  IndicatorType,
  IndicatorValues,
  IpcGetKlinePayload,
  IpcGetIndicatorsPayload,
} from '@/types'

interface MarketState {
  quotes: MarketQuote[]
  klineData: KlineBar[]
  indicators: IndicatorValues | null
  selectedAssetId: string | null
  period: KlinePeriod
  loading: boolean
  error: string | null
  fetchQuotes: () => Promise<void>
  syncQuotes: () => Promise<void>
  fetchKline: (assetId: string, period?: KlinePeriod, force?: boolean) => Promise<void>
  fetchIndicators: (assetId: string, period: KlinePeriod, types: IndicatorType[]) => Promise<void>
  setSelectedAssetId: (assetId: string | null) => void
  setPeriod: (period: KlinePeriod) => void
}

export const useMarketStore = create<MarketState>((set) => ({
  quotes: [],
  klineData: [],
  indicators: null,
  selectedAssetId: null,
  period: '1d',
  loading: false,
  error: null,

  fetchQuotes: async () => {
    set({ loading: true, error: null })
    try {
      const result = await ipcInvoke<MarketQuote[]>(
        IPC_CHANNELS.MARKET_GET_QUOTES
      )
      set({ quotes: result, loading: false })
    } catch (e: any) {
      set({ error: e.message || '行情数据加载失败', loading: false })
    }
  },

  syncQuotes: async () => {
    set({ loading: true, error: null })
    try {
      await ipcInvoke(IPC_CHANNELS.MARKET_SYNC_QUOTES)
      const result = await ipcInvoke<MarketQuote[]>(
        IPC_CHANNELS.MARKET_GET_QUOTES
      )
      set({ quotes: result, loading: false })
    } catch (e: any) {
      set({ error: e.message || '行情同步失败', loading: false })
    }
  },

  fetchKline: async (assetId: string, period?: KlinePeriod, force?: boolean) => {
    const p = period ?? '1d'
    set({ loading: true, error: null, period: p })
    try {
      const payload: IpcGetKlinePayload & { force?: boolean } = { asset_id: assetId, period: p }
      if (force) payload.force = true
      const result = await ipcInvoke<KlineBar[]>(
        IPC_CHANNELS.MARKET_GET_KLINE,
        payload
      )
      set({ klineData: result, loading: false })
    } catch (e: any) {
      set({ error: e.message || 'K线数据加载失败', loading: false })
    }
  },

  fetchIndicators: async (assetId, period, types) => {
    set({ loading: true, error: null })
    try {
      const payload: IpcGetIndicatorsPayload = {
        asset_id: assetId,
        period,
        types,
      }
      const result = await ipcInvoke<IndicatorValues>(
        IPC_CHANNELS.MARKET_GET_INDICATORS,
        payload
      )
      set({ indicators: result, loading: false })
    } catch (e: any) {
      set({ error: e.message || '技术指标加载失败', loading: false })
    }
  },

  setSelectedAssetId: (assetId) => set({ selectedAssetId: assetId }),
  setPeriod: (period) => set({ period }),
}))
