import React from 'react'
import type { WatchlistItemWithStatus } from '@shared/types/database'
import { DataQualityBadge } from './DataQualityBadge'

const ASSET_TYPE_LABEL: Record<string, string> = {
  stock: '股票',
  fund: '基金',
  etf: 'ETF',
  lof: 'LOF',
  index: '指数',
  bond: '债券',
  convertible_bond: '可转债',
  money_market_fund: '货币基金',
  qdii: 'QDII',
  reit: 'REIT',
  cash: '现金',
  other: '其他',
}

export function QuoteCard({ item }: { item: WatchlistItemWithStatus }) {
  const quote = item.quote
  const updatedAt = quote?.quote_time
    ? new Date(quote.quote_time).toLocaleString('zh-CN')
    : '—'

  return (
    <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 16, border: '1px solid var(--line)' }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
        <span>实时行情</span>
        <span style={{ fontSize: 11 }}>更新: {updatedAt}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {quote?.price != null ? `¥${item.asset_type === 'fund' ? quote.price.toFixed(4) : quote.price.toFixed(2)}` : '—'}
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, color: (quote?.change_pct ?? 0) >= 0 ? '#d33f3f' : '#119468' }}>
          {quote?.change_pct != null
            ? `${quote.change_pct >= 0 ? '+' : ''}${quote.change_pct.toFixed(2)}%`
            : '—'}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: 13 }}>
        <div><span style={{ color: 'var(--muted)' }}>市场:</span> {item.market}</div>
        <div><span style={{ color: 'var(--muted)' }}>类型:</span> {ASSET_TYPE_LABEL[item.asset_type] ?? item.asset_type}</div>
        <div><span style={{ color: 'var(--muted)' }}>代码:</span> {item.symbol}</div>
        <div><span style={{ color: 'var(--muted)' }}>持仓:</span> {item.has_position ? `${item.quantity} 股` : '无持仓'}</div>
        {quote?.volume != null && (
          <div><span style={{ color: 'var(--muted)' }}>成交量:</span> {(quote.volume / 10000).toFixed(0)}万</div>
        )}
        {quote?.source && (
          <div><span style={{ color: 'var(--muted)' }}>来源:</span> {quote.source}</div>
        )}
      </div>
      {item.quote_quality && (
        <div style={{ marginTop: 10 }}>
          <DataQualityBadge quality={item.quote_quality} />
        </div>
      )}
    </div>
  )
}
