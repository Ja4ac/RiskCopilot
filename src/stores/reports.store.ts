import { create } from 'zustand'
import { ipcInvoke } from '@/hooks/useIPC'
import { IPC_CHANNELS } from '@/types'
import type { Report } from '@/types'

interface ReportsState {
  reports: Report[]
  selectedReport: Report | null
  loading: boolean
  error: string | null
  fetchReports: () => Promise<void>
  fetchReport: (reportId: string) => Promise<void>
  setSelectedReport: (report: Report | null) => void
}

export const useReportsStore = create<ReportsState>((set) => ({
  reports: [],
  selectedReport: null,
  loading: false,
  error: null,

  fetchReports: async () => {
    set({ loading: true, error: null })
    try {
      const result = await ipcInvoke<Report[]>(
        IPC_CHANNELS.REPORT_GET_LIST
      )
      set({ reports: result, loading: false })
    } catch (e: any) {
      set({ error: e.message || '报告列表加载失败', loading: false })
    }
  },

  fetchReport: async (reportId) => {
    set({ loading: true, error: null })
    try {
      const result = await ipcInvoke<Report>(
        IPC_CHANNELS.REPORT_GET_DETAIL,
        reportId
      )
      set({ selectedReport: result, loading: false })
    } catch (e: any) {
      set({ error: e.message || '报告详情加载失败', loading: false })
    }
  },

  setSelectedReport: (report) => set({ selectedReport: report }),
}))
