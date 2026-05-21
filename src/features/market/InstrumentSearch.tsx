import React from 'react'
import { Panel } from '@/components/ui/Panel'
import { Skeleton } from '@/components/ui/Skeleton'
import type { InstrumentListing } from '@shared/types/database'

interface InstrumentSearchProps {
  searchQuery: string
  searchResults: InstrumentListing[]
  searchLoading: boolean
  onSearch: (query: string) => void
  onAddWatchlist: (item: InstrumentListing) => void
  assetTypeLabel: Record<string, string>
}

export function InstrumentSearch({
  searchQuery,
  searchResults,
  searchLoading,
  onSearch,
  onAddWatchlist,
  assetTypeLabel,
}: InstrumentSearchProps) {
  return (
    <Panel title="发现标的" subtitle="搜索代码、名称或拼音，点击加入自选">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
        <input
          type="text"
          placeholder="输入代码、名称或拼音（如 600519、贵州茅台、mt）..."
          value={searchQuery}
          onChange={(e) => onSearch(e.target.value)}
          style={{ height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 12px', fontSize: 13, background: 'var(--surface)', flex: 1, minWidth: 220 }}
        />
        {searchLoading && <Skeleton width={60} height={14} />}
      </div>

      {searchResults.length > 0 && (
        <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
          <table className="holding-table">
            <thead>
              <tr>
                <th>代码</th>
                <th>名称</th>
                <th>类型</th>
                <th>市场</th>
                <th style={{ textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {searchResults.map((item) => (
                <tr key={`${item.symbol}_${item.market}`}>
                  <td style={{ fontWeight: 700 }}>{item.symbol}</td>
                  <td>{item.name}</td>
                  <td>
                    <span style={{
                      fontSize: 10, padding: '2px 6px', borderRadius: 4,
                      background: item.asset_type === 'stock' ? 'rgba(47,101,217,0.1)' : item.asset_type === 'etf' ? 'rgba(7,143,140,0.1)' : 'rgba(201,154,5,0.1)',
                      color: item.asset_type === 'stock' ? '#2f65d9' : item.asset_type === 'etf' ? '#078f8c' : '#c99a05',
                    }}>
                      {assetTypeLabel[item.asset_type] ?? item.asset_type}
                    </span>
                  </td>
                  <td>{item.market}</td>
                  <td style={{ textAlign: 'center' }}>
                    <button className="text-button" style={{ fontSize: 12 }} onClick={() => onAddWatchlist(item)}>
                      + 加入自选
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {searchQuery.trim() && !searchLoading && searchResults.length === 0 && (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          未找到匹配的标的
        </div>
      )}
    </Panel>
  )
}
