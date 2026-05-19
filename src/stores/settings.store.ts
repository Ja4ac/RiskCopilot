import { create } from 'zustand'
import { ipcInvoke } from '@/hooks/useIPC'
import { IPC_CHANNELS } from '@/types'
import type { AppSettings } from '@/types'

interface SettingsState {
  settings: AppSettings | null
  loading: boolean
  error: string | null
  fetchSettings: () => Promise<void>
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>
}

const defaultSettings: AppSettings = {
  theme: 'light',
  language: 'zh-CN',
  data_refresh_interval_ms: 10000,
  ai_provider: 'deepseek',
  ai_model: 'deepseek-v4-pro',
  notifications_enabled: true,
  sound_enabled: false,
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: defaultSettings,
  loading: false,
  error: null,

  fetchSettings: async () => {
    set({ loading: true, error: null })
    try {
      const result = await ipcInvoke<AppSettings>(
        IPC_CHANNELS.SETTINGS_GET
      )
      set({ settings: { ...defaultSettings, ...result }, loading: false })
    } catch (e: any) {
      set({ error: e.message || '设置加载失败', loading: false })
    }
  },

  updateSettings: async (partial) => {
    set({ loading: true, error: null })
    try {
      const result = await ipcInvoke<AppSettings>(
        IPC_CHANNELS.SETTINGS_UPDATE,
        partial
      )
      set((s) => ({
        settings: s.settings
          ? { ...s.settings, ...result }
          : { ...defaultSettings, ...result },
        loading: false,
      }))
    } catch (e: any) {
      set({ error: e.message || '设置更新失败', loading: false })
    }
  },
}))
