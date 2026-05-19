import { useAppStore, type PageName } from '@/stores/app.store'
import { usePortfolioStore } from '@/stores/portfolio.store'
import { useRiskStore } from '@/stores/risk.store'
import { useAIStore } from '@/stores/ai.store'
import { ipcInvoke } from '@/hooks/useIPC'
import { IPC_CHANNELS } from '@/types'

const pageMeta: Record<PageName, { eyebrow: string; title: string; desc: string }> = {
  dashboard: { eyebrow: '总览', title: '投资仪表盘', desc: '组合风险快照' },
  positions: { eyebrow: '组合', title: '持仓管理', desc: '管理您的股票、基金、ETF持仓' },
  market: { eyebrow: '自选', title: '自选跟踪', desc: '自选持仓跟踪与技术分析' },
  risk: { eyebrow: '风控', title: '风险管理', desc: '组合风险评估与压力测试' },
  news: { eyebrow: '资讯', title: '资讯舆情', desc: '持仓相关新闻与情感分析' },
  ai: { eyebrow: '智能', title: 'AI 助手', desc: '智能投资问答与报告生成' },
  reports: { eyebrow: '报告', title: '分析报告', desc: '日报、周报、月报与分析报告' },
  settings: { eyebrow: '系统', title: '系统设置', desc: '数据源、安全与偏好配置' },
}

export function TopBar() {
  const activePage = useAppStore((s) => s.activePage)
  const meta = pageMeta[activePage] ?? pageMeta.dashboard

  const fetchPositions = usePortfolioStore((s) => s.fetchPositions)
  const fetchSummary = usePortfolioStore((s) => s.fetchSummary)
  const importCSV = usePortfolioStore((s) => s.importCSV)
  const fetchRiskSummary = useRiskStore((s) => s.fetchSummary)
  const fetchRiskExposure = useRiskStore((s) => s.fetchExposure)
  const sendMessage = useAIStore((s) => s.sendMessage)
  const aiLoading = useAIStore((s) => s.loading)

  const handleImport = async () => {
    try {
      // Open file dialog via IPC
      const filePath = await ipcInvoke<string | null>(IPC_CHANNELS.APP_OPEN_FILE)
      if (!filePath) return

      // Read file content via IPC
      const content = await ipcInvoke<string>('app:readFile', filePath)
      if (!content) return

      await importCSV({ csvContent: content, accountId: 'default' })
      // Refresh data after import
      await Promise.all([fetchPositions(), fetchSummary()])
    } catch {
      // Dialog or import failed — error handled by store
    }
  }

  const handleRefresh = async () => {
    await Promise.all([
      fetchPositions(),
      fetchSummary(),
      fetchRiskSummary(),
      fetchRiskExposure(),
    ])
  }

  const handleGenerateReport = async () => {
    if (aiLoading) return
    sendMessage('请生成一份当前持仓组合的风险分析报告')
  }

  const showImport = activePage === 'positions'
  const showRefresh = ['dashboard', 'positions', 'risk'].includes(activePage)

  return (
    <header className="topbar">
      <div>
        <div className="eyebrow">{meta.eyebrow}</div>
        <h1>{meta.title}</h1>
        <p>{meta.desc}</p>
      </div>
      <div className="topbar-actions">
        {showImport && (
          <button className="icon-button" onClick={handleImport}>导入</button>
        )}
        {showRefresh && (
          <button className="icon-button" onClick={handleRefresh}>刷新</button>
        )}
      </div>
    </header>
  )
}
