import { ipcMain } from 'electron'
import { registerPortfolioHandlers } from './portfolio.handlers'
import { registerMarketHandlers } from './market.handlers'
import { registerRiskHandlers } from './risk.handlers'
import { registerNewsHandlers } from './news.handlers'
import { registerAlertHandlers } from './alert.handlers'
import { registerAiHandlers } from './ai.handlers'
import { registerReportHandlers } from './report.handlers'
import { registerSettingsHandlers } from './settings.handlers'
import { registerAppHandlers } from './app.handlers'

export function registerAllHandlers(): void {
  registerPortfolioHandlers()
  registerMarketHandlers()
  registerRiskHandlers()
  registerNewsHandlers()
  registerAlertHandlers()
  registerAiHandlers()
  registerReportHandlers()
  registerSettingsHandlers()
  registerAppHandlers()

  console.log('[IPC] All handlers registered')
}
