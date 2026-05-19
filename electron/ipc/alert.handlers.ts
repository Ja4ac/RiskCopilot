import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { IpcCreateAlertPayload } from '../../shared/types/ipc'
import type { AlertStatus } from '../../shared/types/database'
import { AlertService } from '../services/alert.service'

const alertService = new AlertService()

export function registerAlertHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.ALERT_GET_LIST, async (_event, status?: AlertStatus) => {
    try {
      const alerts = alertService.getList(status)
      return { success: true, data: alerts }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.ALERT_CREATE_RULE, async (_event, payload: IpcCreateAlertPayload) => {
    try {
      const alert = alertService.createRule(payload)
      return { success: true, data: alert }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.ALERT_DELETE_RULE, async (_event, alertId: string) => {
    try {
      alertService.deleteRule(alertId)
      return { success: true, data: null }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.ALERT_ACKNOWLEDGE, async (_event, alertId: string) => {
    try {
      const alert = alertService.acknowledge(alertId)
      return { success: true, data: alert }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.ALERT_EVALUATE, async () => {
    try {
      const changed = alertService.evaluateAll()
      return { success: true, data: changed }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
}
