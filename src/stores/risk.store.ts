import { create } from 'zustand'
import { ipcInvoke } from '@/hooks/useIPC'
import { IPC_CHANNELS } from '@/types'
import type {
  RiskSummary,
  ExposureItem,
  CorrelationPair,
  StressTestResult,
  IpcStressTestPayload,
} from '@/types'

interface RiskState {
  summary: RiskSummary | null
  exposure: ExposureItem[]
  correlation: CorrelationPair[]
  stressResults: StressTestResult[]
  loading: boolean
  error: string | null
  fetchSummary: () => Promise<void>
  fetchExposure: () => Promise<void>
  fetchCorrelation: () => Promise<void>
  runStressTest: (scenarioIds: string[]) => Promise<void>
}

export const useRiskStore = create<RiskState>((set) => ({
  summary: null,
  exposure: [],
  correlation: [],
  stressResults: [],
  loading: false,
  error: null,

  fetchSummary: async () => {
    set({ loading: true, error: null })
    try {
      const result = await ipcInvoke<RiskSummary>(
        IPC_CHANNELS.RISK_GET_SUMMARY
      )
      set({ summary: result, loading: false })
    } catch (e: any) {
      set({ error: e.message || '风险摘要加载失败', loading: false })
    }
  },

  fetchExposure: async () => {
    set({ loading: true, error: null })
    try {
      const result = await ipcInvoke<ExposureItem[]>(
        IPC_CHANNELS.RISK_GET_EXPOSURE
      )
      set({ exposure: result, loading: false })
    } catch (e: any) {
      set({ error: e.message || '风险敞口加载失败', loading: false })
    }
  },

  fetchCorrelation: async () => {
    set({ loading: true, error: null })
    try {
      const result = await ipcInvoke<CorrelationPair[]>(
        IPC_CHANNELS.RISK_GET_CORRELATION
      )
      set({ correlation: result, loading: false })
    } catch (e: any) {
      set({ error: e.message || '相关性数据加载失败', loading: false })
    }
  },

  runStressTest: async (scenarioIds) => {
    set({ loading: true, error: null })
    try {
      const payload: IpcStressTestPayload = { scenario_ids: scenarioIds }
      const result = await ipcInvoke<StressTestResult[]>(
        IPC_CHANNELS.RISK_STRESS_TEST,
        payload
      )
      set({ stressResults: result, loading: false })
    } catch (e: any) {
      set({ error: e.message || '压力测试失败', loading: false })
    }
  },
}))
