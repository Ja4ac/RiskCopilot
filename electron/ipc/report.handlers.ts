import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { ReportType } from '../../shared/types/database'
import { ReportService } from '../services/report.service'
import { createIpcHandler } from './create-handler'

const reportService = new ReportService()

export function registerReportHandlers(): void {
  createIpcHandler(IPC_CHANNELS.REPORT_GET_LIST, async () => {
    return reportService.getReportList()
  })

  createIpcHandler(IPC_CHANNELS.REPORT_GET_DETAIL, async (_event, reportId: string) => {
    const report = reportService.getReport(reportId)
    if (!report) {
      throw new Error(`未找到报告: ${reportId}`)
    }
    return report
  })

  createIpcHandler(IPC_CHANNELS.REPORT_DELETE, async (_event, reportId: string) => {
    reportService.deleteReport(reportId)
    return null
  })
}
