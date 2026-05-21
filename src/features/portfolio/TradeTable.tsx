import React, { useState, useMemo } from 'react'
import { Panel } from '@/components/ui/Panel'
import type { Trade, PositionWithAsset, PortfolioSummary } from '@/types'

interface TradeTableProps {
  trades: Trade[]
  positions: PositionWithAsset[]
  summary: PortfolioSummary | null
  onEdit: (trade: Trade) => void
  onVoid: (trade: Trade) => void
}

export function TradeTable({ trades, positions, summary, onEdit, onVoid }: TradeTableProps) {
  const [timeFilter, setTimeFilter] = useState('all')
  const [assetFilter, setAssetFilter] = useState('')
  const [sideFilter, setSideFilter] = useState('all')

  const filteredTrades = useMemo(() =>
    trades
      .filter((t) => t.status === 'active')
      .filter((t) => {
        if (timeFilter === 'all') return true
        const days = ({ '7d': 7, '30d': 30, '90d': 90 })[timeFilter] ?? 0
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - days)
        try {
          const tradeDate = new Date(t.trade_time)
          if (isNaN(tradeDate.getTime())) return true // include trades with invalid dates
          return tradeDate >= cutoff
        } catch {
          return true
        }
      })
      .filter((t) => {
        if (!assetFilter.trim()) return true
        const pos = positions.find((p) => p.asset_id === t.asset_id)
        const assetName = pos?.asset?.name ?? ''
        const assetSymbol = pos?.asset?.symbol ?? ''
        const q = assetFilter.trim().toLowerCase()
        return assetName.toLowerCase().includes(q) || assetSymbol.toLowerCase().includes(q) || t.asset_id.toLowerCase().includes(q)
      })
      .filter((t) => {
        if (sideFilter === 'all') return true
        return t.side === sideFilter
      })
      .sort((a, b) => b.trade_time.localeCompare(a.trade_time)),
    [trades, positions, timeFilter, assetFilter, sideFilter]
  )

  return (
    <>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        {trades.length > 0 && (
          <>
            <select
              value={timeFilter}
              onChange={(e) => setTimeFilter(e.target.value)}
              style={{ height: 32, border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', fontSize: 13, background: 'var(--surface)' }}
            >
              <option value="all">全部时间</option>
              <option value="7d">最近7天</option>
              <option value="30d">最近30天</option>
              <option value="90d">最近90天</option>
            </select>
            <input
              type="text"
              placeholder="筛选标的..."
              value={assetFilter}
              onChange={(e) => setAssetFilter(e.target.value)}
              style={{ height: 32, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', fontSize: 13, background: 'var(--surface)', width: 140 }}
            />
            <select
              value={sideFilter}
              onChange={(e) => setSideFilter(e.target.value)}
              style={{ height: 32, border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', fontSize: 13, background: 'var(--surface)' }}
            >
              <option value="all">全部方向</option>
              <option value="buy">买入</option>
              <option value="sell">卖出</option>
            </select>
          </>
        )}
      </div>

      <Panel
        title="交易管理"
        subtitle={
          summary
            ? `总市值 ¥${summary.total_market_value.toLocaleString('zh-CN', { minimumFractionDigits: 0 })}  |  共 ${filteredTrades.length} 笔交易`
            : '加载中...'
        }
      >
        {trades.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)' }}>
            <p style={{ fontSize: 16, marginBottom: 8 }}>暂无交易记录</p>
            <p style={{ fontSize: 13 }}>
              点击右上角「添加股票」手动录入股票或ETF，或通过导入功能批量添加
            </p>
          </div>
        ) : (
          <>
          <table className="holding-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>标的</th>
                <th>方向</th>
                <th style={{ textAlign: 'right' }}>数量</th>
                <th style={{ textAlign: 'right' }}>价格</th>
                <th style={{ textAlign: 'right' }}>金额</th>
                <th style={{ textAlign: 'right' }}>手续费</th>
                <th>状态</th>
                <th style={{ textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredTrades.map((t) => {
                  const assetName = t.asset?.name
                  const assetSymbol = t.asset?.symbol
                  return (
                  <tr key={t.id}>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {(() => {
                        try {
                          const d = new Date(t.trade_time)
                          if (isNaN(d.getTime())) return t.trade_time || '时间无效'
                          return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                        } catch {
                          return t.trade_time || '时间无效'
                        }
                      })()}
                    </td>
                    <td>
                      <strong style={{ fontSize: 13 }}>{assetName || assetSymbol || t.asset_id.slice(0, 8)}</strong>
                      {assetSymbol && (
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{assetSymbol}</div>
                      )}
                    </td>
                    <td>
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 4,
                        background: t.side === 'buy' ? 'rgba(211,63,63,0.1)' : 'rgba(17,148,104,0.1)',
                        color: t.side === 'buy' ? '#d33f3f' : '#119468',
                        fontWeight: 700,
                      }}>
                        {t.side === 'buy' ? '买入' : '卖出'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {t.quantity.toLocaleString('zh-CN')}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      ¥{t.source === 'fund_purchase' ? t.price.toFixed(4) : t.price.toFixed(2)}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                      ¥{(t.quantity * t.price).toFixed(2)}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--muted)', fontSize: 12 }}>
                      ¥{(t.fee + t.tax).toFixed(2)}
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: 'var(--green)' }}>生效</span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                        <button
                          className="text-button"
                          style={{ fontSize: 12 }}
                          onClick={() => onEdit(t)}
                        >
                          编辑
                        </button>
                        <button
                          className="text-button"
                          style={{ fontSize: 12, color: 'var(--red)' }}
                          onClick={() => {
                            const assetName2 = t.asset?.name
                            const assetSymbol2 = t.asset?.symbol
                            const displayPrice = t.source === 'fund_purchase' ? t.price.toFixed(4) : t.price.toFixed(2)
                            if (window.confirm(`确认作废这笔交易？\n${assetName2 || assetSymbol2 || t.asset_id.slice(0, 8)} ${t.side === 'buy' ? '买入' : '卖出'} ${t.quantity.toFixed(4)} 份 @ ¥${displayPrice}`)) {
                              onVoid(t)
                            }
                          }}
                        >
                          作废
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              )}
            </tbody>
          </table>
          </>
        )}
      </Panel>
    </>
  )
}
