import { usePortfolioStore } from '@/stores/portfolio.store'
import { useRiskStore } from '@/stores/risk.store'
import { useAppStore } from '@/stores/app.store'

function fmtMoney(n: number): string {
  return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}

export function KPIGrid() {
  const portfolioSummary = usePortfolioStore((s) => s.summary)
  const portfolioLoading = usePortfolioStore((s) => s.loading)
  const portfolioError = usePortfolioStore((s) => s.error)
  const dataSourceStatus = useAppStore((s) => s.dataSourceStatus)

  const loading = portfolioLoading
  const error = portfolioError
  const hasPositions = dataSourceStatus?.has_positions ?? false

  const totalMarketValue = portfolioSummary?.total_market_value ?? 0
  const totalCost = portfolioSummary?.total_cost ?? 0
  const totalPnl = (portfolioSummary?.total_market_value ?? 0) - (portfolioSummary?.total_cost ?? 0)
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0
  const yesterdayPnl = portfolioSummary?.yesterday_pnl ?? 0
  const yesterdayPnlPct = portfolioSummary?.yesterday_pnl_pct ?? 0

  if (error && !portfolioSummary) {
    return (
      <div className="kpi-grid">
        <div className="metric-card" style={{ gridColumn: 'span 3' }}>
          <span className="metric-label">数据加载失败</span>
          <strong style={{ color: 'var(--red)', fontSize: 15 }}>{error}</strong>
        </div>
      </div>
    )
  }

  return (
    <>
      {dataSourceStatus && !dataSourceStatus.has_positions && (
        <div className="alert-item severe" style={{ marginBottom: 14 }}>
          <b>暂无持仓数据</b>
          <p>
            请通过「交易管理」页面导入交易记录或手动添加来开始使用。
            {dataSourceStatus.market_source !== 'real' && ' 当前市场行情为模拟数据，不反映真实市场价格。'}
          </p>
        </div>
      )}

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className={`metric-card ${loading && !portfolioSummary ? '' : ''}`}>
          <span className="metric-label">总资产</span>
          {loading && !portfolioSummary ? (
            <>
              <div className="skeleton" style={{ height: 32, marginTop: 8, borderRadius: 6 }} />
              <div className="skeleton" style={{ height: 14, marginTop: 8, borderRadius: 6, width: '60%' }} />
            </>
          ) : (
            <>
              <strong style={{ fontSize: 28 }}>{hasPositions ? fmtMoney(totalMarketValue) : '--'}</strong>
              <span className="metric-note" style={{ color: 'var(--muted)' }}>
                成本 {hasPositions ? fmtMoney(totalCost) : '--'}
              </span>
            </>
          )}
        </div>

        <div className={`metric-card ${loading && !portfolioSummary ? '' : ''}`}>
          <span className="metric-label">持仓总收益</span>
          {loading && !portfolioSummary ? (
            <>
              <div className="skeleton" style={{ height: 32, marginTop: 8, borderRadius: 6 }} />
              <div className="skeleton" style={{ height: 14, marginTop: 8, borderRadius: 6, width: '60%' }} />
            </>
          ) : (
            <>
              <strong style={{ fontSize: 28, color: hasPositions ? (totalPnl >= 0 ? '#d33f3f' : '#119468') : undefined }}>
                {hasPositions ? fmtMoney(totalPnl) : '--'}
              </strong>
              <span className={`metric-note ${totalPnl >= 0 ? 'gain' : 'loss'}`}>
                {hasPositions ? fmtPct(totalPnlPct) : '暂无数据'}
              </span>
            </>
          )}
        </div>

        <div className={`metric-card ${loading && !portfolioSummary ? '' : ''}`}>
          <span className="metric-label">昨日收益</span>
          {loading && !portfolioSummary ? (
            <>
              <div className="skeleton" style={{ height: 32, marginTop: 8, borderRadius: 6 }} />
              <div className="skeleton" style={{ height: 14, marginTop: 8, borderRadius: 6, width: '60%' }} />
            </>
          ) : (
            <>
              <strong style={{ fontSize: 28, color: hasPositions ? (yesterdayPnl >= 0 ? '#d33f3f' : '#119468') : undefined }}>
                {hasPositions ? fmtMoney(yesterdayPnl) : '--'}
              </strong>
              <span className={`metric-note ${yesterdayPnl >= 0 ? 'gain' : 'loss'}`}>
                {hasPositions ? fmtPct(yesterdayPnlPct) : '暂无数据'}
              </span>
            </>
          )}
        </div>
      </div>
    </>
  )
}
