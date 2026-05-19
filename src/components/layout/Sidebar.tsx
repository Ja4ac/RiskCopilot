import { useAppStore, type PageName } from '@/stores/app.store'

const NAV_ITEMS: { page: PageName; label: string; number: string }[] = [
  { page: 'dashboard', label: '仪表盘', number: '01' },
  { page: 'positions', label: '交易管理', number: '02' },
  { page: 'market', label: '自选跟踪', number: '03' },
  { page: 'risk', label: '风险管理', number: '04' },
  { page: 'news', label: '资讯舆情', number: '05' },
  { page: 'ai', label: 'AI 助手', number: '06' },
  { page: 'reports', label: '分析报告', number: '07' },
  { page: 'settings', label: '系统设置', number: '08' },
]

export function Sidebar() {
  const activePage = useAppStore((s) => s.activePage)
  const setActivePage = useAppStore((s) => s.setActivePage)
  const syncStatus = useAppStore((s) => s.syncStatus)
  const marketIndices = useAppStore((s) => s.marketIndices)
  const dataSourceStatus = useAppStore((s) => s.dataSourceStatus)
  const isMockMode = dataSourceStatus?.market_source === 'simulated' || dataSourceStatus?.market_source === 'none'

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">RP</div>
        <div>
          <div className="brand-title">RiskPilot</div>
          <div className="brand-subtitle">智能风险管理终端</div>
        </div>
      </div>

      <nav className="nav-list">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.page}
            className={`nav-item${activePage === item.page ? ' active' : ''}`}
            onClick={() => setActivePage(item.page)}
          >
            <span>{item.number}</span>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="sidebar-panel">
        <div className="panel-label">市场指数</div>
        {marketIndices.map((m) => (
          <div key={m.name} className="market-row">
            <span>{m.name}</span>
            <b className={m.changeClass}>
              {m.price} {m.change}
            </b>
          </div>
        ))}
      </div>

      <div className="sidebar-panel">
        <div className="panel-label">系统状态</div>
        <div className="status-row">
          <span className={`status-dot${isMockMode ? ' warning' : ''}`} />
          <span>{isMockMode ? '演示模式' : '运行中'}</span>
        </div>
        {isMockMode && (
          <div className="mock-banner" style={{
            marginTop: 8, padding: 8, borderRadius: 6,
            background: 'rgba(212, 119, 6, 0.15)', color: '#ffaa33',
            fontSize: 11, lineHeight: 1.5,
          }}>
            当前使用模拟数据。
            <br/>行情、AI 均未接入真实数据源。
          </div>
        )}
      </div>

      <div className="sidebar-panel sync-panel">
        <div className="panel-label">数据同步</div>
        <div className="sync-row">
          <span className="status-dot" />
          <span>行情 {syncStatus.market}</span>
        </div>
        <div className="sync-row">
          <span className="status-dot" />
          <span>资讯 {syncStatus.news}</span>
        </div>
      </div>
    </aside>
  )
}
