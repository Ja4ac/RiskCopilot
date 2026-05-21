import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { IpcCreateAlertPayload } from '../../shared/types/ipc'
import type { AlertStatus } from '../../shared/types/database'
import { AlertService } from '../services/alert.service'
import { createIpcHandler } from './create-handler'

const alertService = new AlertService()

export function registerAlertHandlers(): void {
  createIpcHandler(IPC_CHANNELS.ALERT_GET_LIST, async (_event, status?: AlertStatus) => {
    return alertService.getList(status)
  })

  createIpcHandler(IPC_CHANNELS.ALERT_CREATE_RULE, async (_event, payload: IpcCreateAlertPayload) => {
    return alertService.createRule(payload)
  })

  createIpcHandler(IPC_CHANNELS.ALERT_DELETE_RULE, async (_event, alertId: string) => {
    alertService.deleteRule(alertId)
    return null
  })

  createIpcHandler(IPC_CHANNELS.ALERT_ACKNOWLEDGE, async (_event, alertId: string) => {
    return alertService.acknowledge(alertId)
  })

  createIpcHandler(IPC_CHANNELS.ALERT_EVALUATE, async () => {
    return alertService.evaluateAll()
  })
}
