import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { IpcStressTestPayload } from '../../shared/types/ipc'
import { RiskService } from '../services/risk.service'
import { createIpcHandler } from './create-handler'

const riskService = new RiskService()

export function registerRiskHandlers(): void {
  createIpcHandler(IPC_CHANNELS.RISK_GET_SUMMARY, async () => {
    return riskService.getSummary()
  })

  createIpcHandler(IPC_CHANNELS.RISK_GET_EXPOSURE, async () => {
    return riskService.getExposure()
  })

  createIpcHandler(IPC_CHANNELS.RISK_GET_CORRELATION, async () => {
    return riskService.getCorrelation()
  })

  createIpcHandler(IPC_CHANNELS.RISK_STRESS_TEST, async (_event, payload: IpcStressTestPayload) => {
    return riskService.stressTest(payload.scenario_ids)
  })
}
