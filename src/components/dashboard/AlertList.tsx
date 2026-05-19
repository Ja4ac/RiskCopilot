import React from 'react'

interface AlertItem {
  id: string
  title: string
  description: string
  severity: 'severe' | 'normal'
}

interface AlertListProps {
  alerts: AlertItem[]
  count?: number
  loading?: boolean
}

export function AlertList({ alerts, count, loading = false }: AlertListProps) {
  if (loading) {
    return (
      <div className="panel">
        <div className="panel-header compact">
          <h2>高优先级告警</h2>
          <div className="skeleton" style={{ width: 32, height: 24, borderRadius: 999 }} />
        </div>
        <div className="alert-list">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="skeleton"
              style={{ height: 64, borderRadius: 8, borderLeft: '4px solid var(--line)' }}
            />
          ))}
        </div>
      </div>
    )
  }

  const displayCount = count ?? alerts.length

  return (
    <div className="panel">
      <div className="panel-header compact">
        <h2>高优先级告警</h2>
        {displayCount > 0 && <span className="count-badge">{displayCount}</span>}
      </div>
      <div className="alert-list">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className={`alert-item ${alert.severity === 'severe' ? 'severe' : ''}`}
          >
            <b>{alert.title}</b>
            <p>{alert.description}</p>
          </div>
        ))}
        {alerts.length === 0 && (
          <div style={{ color: 'var(--muted)', fontSize: 13, padding: 12, textAlign: 'center' }}>
            暂无告警
          </div>
        )}
      </div>
    </div>
  )
}
