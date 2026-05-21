import React, { useState, useMemo } from 'react'
import type { PositionWithAsset } from '@shared/types/database'

interface HoldingsTableProps {
  positions: PositionWithAsset[]
  loading?: boolean
  onSelect?: (assetId: string) => void
}

type SortField = 'name' | 'price' | 'marketValue' | 'cost' | 'pnl' | 'pnlPct' | 'yesterdayPnl' | 'dailyPnl'
type SortDir = 'asc' | 'desc'

const TYPE_LABEL: Record<string, string> = {
  stock: '股票',
  fund: '基金',
  etf: 'ETF',
  lof: 'LOF',
}

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 8 }).map((_, i) => (
        <td key={i}>
          <div className="skeleton" style={{ height: 14, width: i === 0 ? 100 : 60, borderRadius: 4 }} />
        </td>
      ))}
    </tr>
  )
}

export function HoldingsTable({ positions, loading = false, onSelect }: HoldingsTableProps) {
  const [sortField, setSortField] = useState<SortField>('pnlPct')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const sortedPositions = useMemo(() => {
    const sorted = [...positions]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'name':
          cmp = a.asset.name.localeCompare(b.asset.name, 'zh')
          break
        case 'price':
          cmp = (a.quote?.price ?? 0) - (b.quote?.price ?? 0)
          break
        case 'marketValue':
          cmp = a.market_value - b.market_value
          break
        case 'cost':
          cmp = a.cost_amount - b.cost_amount
          break
        case 'pnl':
          cmp = a.unrealized_pnl - b.unrealized_pnl
          break
        case 'pnlPct':
          cmp = a.total_return_pct - b.total_return_pct
          break
        case 'yesterdayPnl':
          cmp = a.yesterday_pnl - b.yesterday_pnl
          break
        case 'dailyPnl':
          cmp = a.daily_pnl - b.daily_pnl
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [positions, sortField, sortDir])

  const SortIndicator = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null
    return <span style={{ marginLeft: 4, fontSize: 10 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
  }

  if (loading) {
    return (
      <table className="holding-table">
        <thead>
          <tr>
            <th>资产</th>
            <th>最新价</th>
            <th>市值</th>
            <th>成本</th>
            <th>总收益</th>
            <th>持有收益率</th>
            <th>昨日收益</th>
            <th>今日收益</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <table className="holding-table">
      <thead>
        <tr>
          <th onClick={() => handleSort('name')} style={{ cursor: 'pointer' }}>
            资产 <SortIndicator field="name" />
          </th>
          <th onClick={() => handleSort('price')} style={{ cursor: 'pointer', textAlign: 'right' }}>
            最新价 <SortIndicator field="price" />
          </th>
          <th onClick={() => handleSort('marketValue')} style={{ cursor: 'pointer', textAlign: 'right' }}>
            市值 <SortIndicator field="marketValue" />
          </th>
          <th onClick={() => handleSort('cost')} style={{ cursor: 'pointer', textAlign: 'right' }}>
            成本 <SortIndicator field="cost" />
          </th>
          <th onClick={() => handleSort('pnl')} style={{ cursor: 'pointer', textAlign: 'right' }}>
            总收益 <SortIndicator field="pnl" />
          </th>
          <th onClick={() => handleSort('pnlPct')} style={{ cursor: 'pointer', textAlign: 'right' }}>
            持有收益率 <SortIndicator field="pnlPct" />
          </th>
          <th onClick={() => handleSort('yesterdayPnl')} style={{ cursor: 'pointer', textAlign: 'right' }}>
            昨日收益 <SortIndicator field="yesterdayPnl" />
          </th>
          <th onClick={() => handleSort('dailyPnl')} style={{ cursor: 'pointer', textAlign: 'right' }}>
            今日收益 <SortIndicator field="dailyPnl" />
          </th>
        </tr>
      </thead>
      <tbody>
        {sortedPositions.map((pos) => {
          const rawPrice = pos.quote?.price ?? 0
          const price = rawPrice > 0 ? rawPrice : (pos.quantity > 0 ? pos.market_value / pos.quantity : pos.avg_cost)
          const pnl = pos.unrealized_pnl
          const pnlPct = pos.total_return_pct
          const yesterdayVal = pos.yesterday_pnl
          const dailyPnl = pos.daily_pnl

          return (
            <tr
              key={pos.id}
              onClick={() => onSelect?.(pos.asset_id)}
              style={{ cursor: onSelect ? 'pointer' : 'default' }}
            >
              <td>
                <strong style={{ fontSize: 13 }}>{pos.asset.name}</strong>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {pos.asset.symbol}
                  <span style={{
                    marginLeft: 6, fontSize: 10, padding: '1px 5px', borderRadius: 4,
                    background: pos.asset.asset_type === 'stock' ? 'rgba(47,101,217,0.1)' : pos.asset.asset_type === 'etf' ? 'rgba(7,143,140,0.1)' : 'rgba(201,154,5,0.1)',
                    color: pos.asset.asset_type === 'stock' ? '#2f65d9' : pos.asset.asset_type === 'etf' ? '#078f8c' : '#c99a05',
                  }}>
                    {TYPE_LABEL[pos.asset.asset_type] ?? pos.asset.asset_type}
                  </span>
                </div>
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                ¥{pos.asset.asset_type === 'fund' ? price.toFixed(4) : price.toFixed(2)}
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                ¥{pos.market_value.toFixed(2)}
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--muted)', fontSize: 12 }}>
                ¥{pos.cost_amount.toFixed(2)}
              </td>
              <td style={{
                textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                color: pnl >= 0 ? '#d33f3f' : '#119468', fontWeight: 700,
              }}>
                {pnl >= 0 ? '+' : ''}¥{pnl.toFixed(2)}
              </td>
              <td style={{
                textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                color: pnlPct >= 0 ? '#d33f3f' : '#119468', fontWeight: 700,
              }}>
                {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
              </td>
              {/* 昨日盈亏（金额） */}
              <td style={{
                textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                color: yesterdayVal >= 0 ? '#d33f3f' : '#119468', fontSize: 13,
              }}>
                {yesterdayVal >= 0 ? '+' : ''}¥{yesterdayVal.toFixed(2)}
              </td>
              {/* 实时盈亏（今日金额） */}
              <td style={{
                textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                color: dailyPnl >= 0 ? '#d33f3f' : '#119468', fontSize: 13,
              }}>
                {dailyPnl >= 0 ? '+' : ''}¥{dailyPnl.toFixed(2)}
              </td>
            </tr>
          )
        })}
        {sortedPositions.length === 0 && (
          <tr>
            <td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)', padding: 32 }}>
              暂无持仓数据
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}
