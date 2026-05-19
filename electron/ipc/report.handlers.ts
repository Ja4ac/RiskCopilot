import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { ReportType } from '../../shared/types/database'
import { ReportService } from '../services/report.service'

const reportService = new ReportService()

export function registerReportHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.REPORT_GET_LIST, async () => {
    try {
      const reports = reportService.getReportList()
      return { success: true, data: reports }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.REPORT_GET_DETAIL, async (_event, reportId: string) => {
    try {
      const report = reportService.getReport(reportId)
      if (!report) {
        return { success: false, error: `未找到报告: ${reportId}` }
      }
      return { success: true, data: report }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.REPORT_DELETE, async (_event, reportId: string) => {
    try {
      reportService.deleteReport(reportId)
      return { success: true, data: null }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
}
