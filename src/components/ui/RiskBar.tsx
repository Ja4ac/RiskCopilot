import React from 'react'

interface RiskBarProps {
  label: string
  value: number
}

export const RiskBar: React.FC<RiskBarProps> = ({ label, value }) => {
  const pct = Math.min(100, Math.max(0, value))
  return (
    <div className="risk-row">
      <span>{label}</span>
      <div>
        <i style={{ width: `${pct}%` }} />
      </div>
      <b>{pct.toFixed(0)}</b>
    </div>
  )
}
