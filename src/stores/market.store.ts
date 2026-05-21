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
  KlineFetchResult,
  KlineErrorCode,
} from '@/types'

interface MarketState {
  quotes: MarketQuote[]
  klineData: KlineBar[]
  /** Structured metadata from last K-line fetch */
  klineSource: KlineFetchResult['source']
  klineCacheHit: boolean
  klineProviderStatus: KlineFetchResult['providerStatus']
  klineErrorCode: KlineErrorCode
  klineErrorMessage: string | null
  indicators: IndicatorValues | null
  selectedAssetId: string | null
  period: KlinePeriod
  /** Generic fallback (kept for backward compat) */
  loading: boolean
  error: string | null
  /** Per-action loading states */
  quotesLoading: boolean
  klineLoading: boolean
  indicatorsLoading: boolean
  quotesError: string | null
  klineError: string | null
  indicatorsError: string | null
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
  klineSource: 'none',
  klineCacheHit: false,
  klineProviderStatus: 'not_checked',
  klineErrorCode: 'NONE',
  klineErrorMessage: null,
  indicators: null,
  selectedAssetId: null,
  period: '1d',
  loading: false,
  error: null,
  quotesLoading: false,
  klineLoading: false,
  indicatorsLoading: false,
  quotesError: null,
  klineError: null,
  indicatorsError: null,

  fetchQuotes: async () => {
    set({ quotesLoading: true, quotesError: null })
    try {
      const result = await ipcInvoke<MarketQuote[]>(IPC_CHANNELS.MARKET_GET_QUOTES)
      set({ quotes: result, quotesLoading: false, loading: false })
    } catch (e: any) {
      set({ quotesError: e.message || '行情数据加载失败', quotesLoading: false, loading: false, error: e.message || '行情数据加载失败' })
    }
  },

  syncQuotes: async () => {
    set({ quotesLoading: true, quotesError: null })
    try {
      await ipcInvoke(IPC_CHANNELS.MARKET_SYNC_QUOTES)
      const result = await ipcInvoke<MarketQuote[]>(IPC_CHANNELS.MARKET_GET_QUOTES)
      set({ quotes: result, quotesLoading: false, loading: false })
    } catch (e: any) {
      set({ quotesError: e.message || '行情同步失败', quotesLoading: false, loading: false, error: e.message || '行情同步失败' })
    }
  },

  fetchKline: async (assetId: string, period?: KlinePeriod, force?: boolean) => {
    const p = period ?? '1d'
    set({ klineLoading: true, klineError: null, period: p })
    try {
      const payload: IpcGetKlinePayload & { force?: boolean } = { asset_id: assetId, period: p }
      if (force) payload.force = true
      const result = await ipcInvoke<KlineFetchResult>(IPC_CHANNELS.MARKET_GET_KLINE, payload)
      set({
        klineData: result.bars,
        klineSource: result.source,
        klineCacheHit: result.cacheHit,
        klineProviderStatus: result.providerStatus,
        klineErrorCode: result.errorCode,
        klineErrorMessage: result.errorMessage ?? null,
        klineLoading: false,
        loading: false,
        error: result.errorCode !== 'NONE' && result.bars.length === 0
          ? (result.errorMessage || 'K线数据获取异常')
          : null,
      })
    } catch (e: any) {
      set({
        error: e.message || 'K线数据加载失败', klineError: e.message || 'K线数据加载失败',
        klineErrorCode: 'NETWORK_ERROR', klineErrorMessage: e.message || 'K线数据加载失败',
        klineLoading: false, loading: false,
      })
    }
  },

  fetchIndicators: async (assetId, period, types) => {
    set({ indicatorsLoading: true, indicatorsError: null })
    try {
      const payload: IpcGetIndicatorsPayload = { asset_id: assetId, period, types }
      const result = await ipcInvoke<IndicatorValues>(IPC_CHANNELS.MARKET_GET_INDICATORS, payload)
      set({ indicators: result, indicatorsLoading: false, loading: false })
    } catch (e: any) {
      set({ indicatorsError: e.message || '技术指标加载失败', indicatorsLoading: false, loading: false, error: e.message || '技术指标加载失败' })
    }
  },

  setSelectedAssetId: (assetId) => set({ selectedAssetId: assetId }),
  setPeriod: (period) => set({ period }),
}))
