import { create } from 'zustand'
import { ipcInvoke } from '@/hooks/useIPC'
import { IPC_CHANNELS } from '@/types'
import type { NewsWithAsset, IpcGetNewsPayload, Importance } from '@/types'

interface NewsFilters {
  importance?: Importance
  assetId?: string
  limit?: number
  offset?: number
}

interface NewsState {
  items: NewsWithAsset[]
  loading: boolean
  error: string | null
  fetchNews: (filters?: NewsFilters) => Promise<void>
  fetchAssetNews: (assetId: string) => Promise<void>
}

export const useNewsStore = create<NewsState>((set, get) => ({
  items: [],
  loading: false,
  error: null,

  fetchNews: async (filters) => {
    set({ loading: true, error: null })
    try {
      const payload: IpcGetNewsPayload = {}
      if (filters?.importance) payload.importance = filters.importance
      if (filters?.assetId) payload.asset_id = filters.assetId
      if (filters?.limit) payload.limit = filters.limit
      if (filters?.offset !== undefined) payload.offset = filters.offset
      const result = await ipcInvoke<{ items: NewsWithAsset[]; total: number }>(
        IPC_CHANNELS.NEWS_GET_LIST,
        payload
      )
      set({ items: result.items, loading: false })
    } catch (e: any) {
      set({ error: e.message || '新闻加载失败', loading: false })
    }
  },

  fetchAssetNews: async (assetId) => {
    set({ loading: true, error: null })
    try {
      const result = await ipcInvoke<NewsWithAsset[]>(
        IPC_CHANNELS.NEWS_GET_ASSET_NEWS,
        assetId
      )
      set({ items: result, loading: false })
    } catch (e: any) {
      set({ error: e.message || '资产新闻加载失败', loading: false })
    }
  },
}))
