import React, { useState } from 'react'

interface PanelProps {
  title?: string
  subtitle?: string
  tooltip?: string
  actions?: React.ReactNode
  compact?: boolean
  children: React.ReactNode
  className?: string
}

export const Panel: React.FC<PanelProps> = ({ title, subtitle, tooltip, actions, compact, children, className = '' }) => {
  const headerClass = compact ? 'panel-header compact' : 'panel-header'
  const [tipVisible, setTipVisible] = useState(false)
  return (
    <div className={`panel ${className}`}>
      {(title || subtitle || actions) && (
        <div className={headerClass}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {title && <h2>{title}</h2>}
              {tooltip && (
                <span
                  style={{ position: 'relative', cursor: 'help' }}
                  onMouseEnter={() => setTipVisible(true)}
                  onMouseLeave={() => setTipVisible(false)}
                >
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 16, height: 16, borderRadius: '50%', background: 'var(--surface-soft)',
                    color: 'var(--muted)', fontSize: 11, fontWeight: 700,
                    border: '1px solid var(--line)',
                  }}>?</span>
                  {tipVisible && (
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
            </div>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div>{actions}</div>}
        </div>
      )}
      {children}
    </div>
  )
}
