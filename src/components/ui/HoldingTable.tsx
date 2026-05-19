import React from 'react'

interface Column {
  key: string
  label: string
  sortable?: boolean
  render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode
}

interface HoldingTableProps {
  columns: Column[]
  data: Record<string, unknown>[]
  sortable?: boolean
  onSort?: (key: string) => void
  sortKey?: string
  sortDir?: 'asc' | 'desc'
}

export const HoldingTable: React.FC<HoldingTableProps> = ({ columns, data }) => {
  if (!data.length) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
        暂无持仓数据
      </div>
    )
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="holding-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td key={col.key}>
                  {col.render ? col.render(row[col.key], row) : String(row[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
