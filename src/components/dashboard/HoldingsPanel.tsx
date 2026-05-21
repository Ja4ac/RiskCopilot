import { useState, useMemo } from 'react'
import { usePortfolioStore } from '@/stores/portfolio.store'
import { HoldingsTable } from './HoldingsTable'
import { Panel } from '../ui/Panel'

function fmtMoney(n: number): string {
  return '¥' + Math.round(n).toLocaleString('zh-CN')
}

function fmtPct(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}

interface GroupedHoldingsProps {
  title: string
  type: string
  icon: string
  positions: import('@shared/types/database').PositionWithAsset[]
  loading: boolean
  defaultExpanded?: boolean
  onSelect?: (assetId: string) => void
}

function GroupedHoldings({ title, type, icon, positions, loading, defaultExpanded = true, onSelect }: GroupedHoldingsProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

    const groupSummary = useMemo(() => {
    const mv = positions.reduce((s, p) => s + p.market_value, 0)
    const cost = positions.reduce((s, p) => s + p.cost_amount, 0)
    const pnl = mv - cost
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0
    const yesterday = positions.reduce((s, p) => s + p.yesterday_pnl, 0)
    return { mv, cost, pnl, pnlPct, yesterday }
  }, [positions])

  if (!loading && positions.length === 0) return null

  return (
    <div style={{ marginBottom: 14 }}>
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 14px', background: 'var(--surface)', borderRadius: 8,
          cursor: 'pointer', border: '1px solid var(--line)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>{icon}</span>
          <div>
            <strong style={{ fontSize: 14 }}>{title}</strong>
            <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 12 }}>
              {positions.length} 只持仓
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 13 }}>
          <span>市值 <b>{fmtMoney(groupSummary.mv)}</b></span>
          <span style={{ color: groupSummary.pnl >= 0 ? '#d33f3f' : '#119468' }}>
            盈亏 <b>{fmtMoney(groupSummary.pnl)} ({fmtPct(groupSummary.pnlPct)})</b>
          </span>
          <span style={{ color: groupSummary.yesterday >= 0 ? '#d33f3f' : '#119468' }}>
            昨日 <b>{fmtMoney(groupSummary.yesterday)}</b>
          </span>
          <span style={{
            display: 'inline-block', width: 20, textAlign: 'center',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}>▼</span>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 8 }}>
          <HoldingsTable positions={positions} loading={loading} onSelect={onSelect} />
        </div>
      )}
    </div>
  )
}

interface HoldingsPanelProps {
  onSelect?: (assetId: string) => void
}

export function HoldingsPanel({ onSelect }: HoldingsPanelProps) {
  const positions = usePortfolioStore((s) => s.positions)
  const loading = usePortfolioStore((s) => s.loading)
  const error = usePortfolioStore((s) => s.error)

  const stockPositions = useMemo(
    () => positions.filter((p) => p.asset.asset_type === 'stock'),
    [positions]
  )
  const fundPositions = useMemo(
    () => positions.filter((p) => p.asset.asset_type === 'fund'),
    [positions]
  )
  const etfPositions = useMemo(
    () => positions.filter((p) => p.asset.asset_type === 'etf' || p.asset.asset_type === 'lof'),
    [positions]
  )

  if (error && positions.length === 0) {
    return (
      <Panel title="我的持仓">
        <div style={{ color: 'var(--red)', fontSize: 13, padding: 20, textAlign: 'center' }}>
          加载失败：{error}
        </div>
      </Panel>
    )
  }

  return (
    <Panel title="我的持仓" subtitle="按资产类型分组，点击表头可排序">
      <GroupedHoldings
        title="股票持仓"
        type="stock"
        icon="📈"
        positions={stockPositions}
        loading={loading}
        defaultExpanded={true}
        onSelect={onSelect}
      />
      <GroupedHoldings
        title="基金持仓"
        type="fund"
        icon="💰"
        positions={fundPositions}
        loading={loading}
        defaultExpanded={true}
        onSelect={onSelect}
      />
      <GroupedHoldings
        title="ETF / LOF"
        type="etf"
        icon="📊"
        positions={etfPositions}
        loading={loading}
        defaultExpanded={true}
        onSelect={onSelect}
      />
      {!loading && positions.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
          暂无持仓数据，请前往「交易管理」添加股票
        </div>
      )}
    </Panel>
  )
}
