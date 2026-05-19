import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { IpcStressTestPayload } from '../../shared/types/ipc'
import { RiskService } from '../services/risk.service'

const riskService = new RiskService()

export function registerRiskHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.RISK_GET_SUMMARY, async () => {
    try {
      const summary = riskService.getSummary()
      return { success: true, data: summary }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.RISK_GET_EXPOSURE, async () => {
    try {
      const exposure = riskService.getExposure()
      return { success: true, data: exposure }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.RISK_GET_CORRELATION, async () => {
    try {
      const correlation = riskService.getCorrelation()
      return { success: true, data: correlation }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.RISK_STRESS_TEST, async (_event, payload: IpcStressTestPayload) => {
    try {
      const results = riskService.stressTest(payload.scenario_ids)
      return { success: true, data: results }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
}
