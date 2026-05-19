import { create } from 'zustand'
import { ipcInvoke } from '@/hooks/useIPC'

export type PageName =
  | 'dashboard'
  | 'positions'
  | 'market'
  | 'risk'
  | 'news'
  | 'ai'
  | 'reports'
  | 'settings'

export interface DataSourceStatus {
  market_source: 'simulated' | 'real' | 'none'
  news_source: 'simulated' | 'real' | 'none'
  ai_provider: string
  ai_model: string
  is_ai_real: boolean
  has_positions: boolean
  position_count: number
}

interface AppState {
  activePage: PageName
  drawerOpen: boolean
  dataSourceStatus: DataSourceStatus | null
  syncStatus: { market: string; news: string }
  marketIndices: {
    name: string
    price: string
    change: string
    changeClass: string
  }[]
  setActivePage: (page: PageName) => void
  toggleDrawer: () => void
  setSyncStatus: (status: Partial<AppState['syncStatus']>) => void
  setMarketIndices: (indices: AppState['marketIndices']) => void
  fetchDataSourceStatus: () => Promise<void>
}

const NO_DATA_INDICES = [
  { name: '暂无市场数据', price: '--', change: '--', changeClass: '' },
]

export const useAppStore = create<AppState>((set) => ({
  activePage: 'dashboard',
  drawerOpen: true,
  dataSourceStatus: null,
  syncStatus: { market: '未同步', news: '未同步' },
  marketIndices: NO_DATA_INDICES,
  setActivePage: (page) => set({ activePage: page }),
  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
  setSyncStatus: (status) =>
    set((s) => ({ syncStatus: { ...s.syncStatus, ...status } })),
  setMarketIndices: (indices) => set({ marketIndices: indices }),

  fetchDataSourceStatus: async () => {
    try {
      const status = await ipcInvoke<DataSourceStatus>('app:getDataSourceStatus')
      set({ dataSourceStatus: status })

      // Update market indices based on data source
      if (status.market_source === 'none') {
        set({ marketIndices: NO_DATA_INDICES })
      } else if (status.market_source === 'real') {
        set({
          marketIndices: [
            { name: '实时行情', price: '已连接', change: '真实数据', changeClass: 'green' },
          ],
          syncStatus: {
            market: '真实行情',
            news: status.news_source === 'real' ? '真实舆情' : '模拟舆情',
          },
        })
      } else {
        set({
          marketIndices: [
            { name: '市场数据(模拟)', price: '演示模式', change: '--', changeClass: '' },
          ],
          syncStatus: {
            market: '模拟数据',
            news: status.news_source === 'real' ? '真实舆情' : '模拟舆情',
          },
        })
      }
    } catch {
      // Non-critical — keep defaults
    }
  },
}))
