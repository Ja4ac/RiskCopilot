import React, { useState } from 'react'

interface MetricCardProps {
  label: string
  value: string
  note?: string
  noteClassName?: string
  variant?: 'default' | 'risk-high'
  loading?: boolean
  error?: string | null
  tooltip?: string
}

function SkeletonBlock({ height = 27 }: { height?: number }) {
  return <div className="skeleton" style={{ height, marginTop: 11, borderRadius: 6 }} />
}

export function MetricCard({
  label,
  value,
  note,
  noteClassName,
  variant = 'default',
  loading = false,
  error = null,
  tooltip,
}: MetricCardProps) {
  const [showTip, setShowTip] = useState(false)

  const labelContent = (
    <span className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {label}
      {tooltip && (
        <span
          style={{ position: 'relative', cursor: 'help' }}
          onMouseEnter={() => setShowTip(true)}
          onMouseLeave={() => setShowTip(false)}
        >
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 14, height: 14, borderRadius: '50%', background: 'var(--surface-soft)',
            color: 'var(--muted)', fontSize: 10, fontWeight: 700,
            border: '1px solid var(--line)',
          }}>?</span>
          {showTip && (
            <span style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 10,
              background: 'var(--ink)', color: '#fff', padding: '6px 10px',
              borderRadius: 6, fontSize: 12, whiteSpace: 'nowrap',
              marginTop: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            }}>
              {tooltip}
            </span>
          )}
        </span>
      )}
    </span>
  )

  if (error) {
    return (
      <div className={`metric-card ${variant === 'risk-high' ? 'risk-high' : ''}`}>
        {labelContent}
        <strong style={{ color: 'var(--red)', fontSize: 15 }}>加载失败</strong>
        <span className="metric-note" style={{ color: 'var(--red)' }}>
          {error}
        </span>
      </div>
    )
  }

  if (loading) {
    return (
      <div className={`metric-card ${variant === 'risk-high' ? 'risk-high' : ''}`}>
        {labelContent}
        <SkeletonBlock height={27} />
        <SkeletonBlock height={13} />
      </div>
    )
  }

  return (
    <div className={`metric-card ${variant === 'risk-high' ? 'risk-high' : ''}`}>
      {labelContent}
      <strong>{value}</strong>
      {note && <span className={`metric-note${noteClassName ? ' ' + noteClassName : ''}`}>{note}</span>}
    </div>
  )
}
