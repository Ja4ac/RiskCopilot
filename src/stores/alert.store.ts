import { create } from 'zustand'
import { ipcInvoke } from '@/hooks/useIPC'
import { IPC_CHANNELS } from '@/types'
import type { Alert, AlertStatus, IpcCreateAlertPayload } from '@/types'

interface AlertState {
  alerts: Alert[]
  loading: boolean
  error: string | null
  fetchAlerts: () => Promise<void>
  createRule: (payload: IpcCreateAlertPayload) => Promise<void>
  acknowledge: (alertId: string) => Promise<void>
}

export const useAlertStore = create<AlertState>((set) => ({
  alerts: [],
  loading: false,
  error: null,

  fetchAlerts: async () => {
    set({ loading: true, error: null })
    try {
      const result = await ipcInvoke<Alert[]>(
        IPC_CHANNELS.ALERT_GET_LIST
      )
      set({ alerts: result, loading: false })
    } catch (e: any) {
      set({ error: e.message || '预警列表加载失败', loading: false })
    }
  },

  createRule: async (payload) => {
    set({ loading: true, error: null })
    try {
      await ipcInvoke(IPC_CHANNELS.ALERT_CREATE_RULE, payload)
      set({ loading: false })
    } catch (e: any) {
      set({ error: e.message || '创建预警规则失败', loading: false })
    }
  },

  acknowledge: async (alertId) => {
    set({ loading: true, error: null })
    try {
      await ipcInvoke(IPC_CHANNELS.ALERT_ACKNOWLEDGE, alertId)
      set((s) => ({
        alerts: s.alerts.map((a) =>
          a.id === alertId
            ? { ...a, status: 'acknowledged' as AlertStatus }
            : a
        ),
        loading: false,
      }))
    } catch (e: any) {
      set({ error: e.message || '预警确认失败', loading: false })
    }
  },
}))
