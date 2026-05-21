import React from 'react'
import { Panel } from '@/components/ui/Panel'
import { Skeleton } from '@/components/ui/Skeleton'
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

interface WatchlistPanelProps {
  holdingItems: WatchlistItemWithStatus[]
  watchingItems: WatchlistItemWithStatus[]
  selectedItem: WatchlistItemWithStatus | null
  watchlistLoading: boolean
  onSelect: (item: WatchlistItemWithStatus) => void
  onRemove: (assetId: string) => void
  onForceRefresh: (item: WatchlistItemWithStatus) => void
  onTodayRefresh: (item: WatchlistItemWithStatus) => void
  onRefresh: () => void
}

export function WatchlistPanel({
  holdingItems,
  watchingItems,
  selectedItem,
  watchlistLoading,
  onSelect,
  onRemove,
  onForceRefresh,
  onTodayRefresh,
  onRefresh,
}: WatchlistPanelProps) {
  const totalItems = holdingItems.length + watchingItems.length

  return (
    <Panel
      title="我的自选"
      subtitle={`已购入 ${holdingItems.length} 只 / 未购入 ${watchingItems.length} 只`}
      actions={
        <button className="icon-button" onClick={onRefresh} disabled={watchlistLoading}>
          {watchlistLoading ? '刷新中...' : '刷新'}
        </button>
      }
    >
      {watchlistLoading && totalItems === 0 ? (
        <Skeleton height={120} />
      ) : totalItems === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ fontSize: 14, marginBottom: 8 }}>暂无自选标的</div>
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            您可以通过以下方式添加：<br/>
            1. 在上方搜索框输入代码（如 300274）或名称，点击「+ 加入自选」<br/>
            2. 在「交易管理」中买入标的，系统会自动加入自选
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {holdingItems.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>已购入 ({holdingItems.length})</div>
              <WatchlistTable
                items={holdingItems}
                selectedItem={selectedItem}
                onSelect={onSelect}
                onRemove={onRemove}
                onForceRefresh={onForceRefresh}
                onTodayRefresh={onTodayRefresh}
              />
            </div>
          )}
          {watchingItems.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>未购入 ({watchingItems.length})</div>
              <WatchlistTable
                items={watchingItems}
                selectedItem={selectedItem}
                onSelect={onSelect}
                onRemove={onRemove}
                onForceRefresh={onForceRefresh}
                onTodayRefresh={onTodayRefresh}
              />
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}

// ── Watchlist Table ──

function WatchlistTable({
  items,
  selectedItem,
  onSelect,
  onRemove,
  onForceRefresh,
  onTodayRefresh,
}: {
  items: WatchlistItemWithStatus[]
  selectedItem: WatchlistItemWithStatus | null
  onSelect: (item: WatchlistItemWithStatus) => void
  onRemove: (assetId: string) => void
  onForceRefresh: (item: WatchlistItemWithStatus) => void
  onTodayRefresh: (item: WatchlistItemWithStatus) => void
}) {
  return (
    <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
      <table className="holding-table">
        <thead>
          <tr>
            <th>代码</th>
            <th>名称</th>
            <th>类型</th>
            <th style={{ textAlign: 'right' }}>最新价</th>
            <th style={{ textAlign: 'right' }}>涨跌幅</th>
            <th>质量</th>
            <th style={{ textAlign: 'center' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const price = item.quote?.price
            const changePct = item.quote?.change_pct
            const isFund = item.asset_type === 'fund'
            const isSelected = selectedItem?.asset_id === item.asset_id
            return (
              <tr
                key={item.id}
                onClick={() => onSelect(item)}
                style={{ cursor: 'pointer', background: isSelected ? 'rgba(47,101,217,0.06)' : undefined }}
              >
                <td style={{ fontWeight: 700 }}>{item.symbol}</td>
                <td>{item.name}</td>
                <td>
                  <span style={{
                    fontSize: 10, padding: '2px 6px', borderRadius: 4,
                    background: item.asset_type === 'stock' ? 'rgba(47,101,217,0.1)' : item.asset_type === 'etf' ? 'rgba(7,143,140,0.1)' : 'rgba(201,154,5,0.1)',
                    color: item.asset_type === 'stock' ? '#2f65d9' : item.asset_type === 'etf' ? '#078f8c' : '#c99a05',
                  }}>
                    {ASSET_TYPE_LABEL[item.asset_type] ?? item.asset_type}
                  </span>
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {price != null ? `¥${isFund ? price.toFixed(4) : price.toFixed(2)}` : '—'}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: (changePct ?? 0) >= 0 ? '#d33f3f' : '#119468', fontWeight: 700 }}>
                  {changePct != null ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%` : '—'}
                </td>
                <td>
                  {item.quote_quality ? <DataQualityBadge quality={item.quote_quality} /> : '—'}
                </td>
                <td style={{ textAlign: 'center' }}>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                    <button
                      className="text-button"
                      style={{ fontSize: 11, color: '#2f65d9' }}
                      title="从在线数据源强制获取该标的全部数据"
                      onClick={(e) => { e.stopPropagation(); onForceRefresh(item) }}
                    >
                      强制刷新
                    </button>
                    <button
                      className="text-button"
                      style={{ fontSize: 11, color: '#078f8c' }}
                      title="仅刷新该标的今日价格/净值"
                      onClick={(e) => { e.stopPropagation(); onTodayRefresh(item) }}
                    >
                      今日刷新
                    </button>
                    <button
                      className="text-button"
                      style={{ fontSize: 11, color: '#d33f3f' }}
                      onClick={(e) => { e.stopPropagation(); onRemove(item.asset_id) }}
                    >
                      移除
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
