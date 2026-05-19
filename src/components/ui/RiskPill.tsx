import React from 'react'

interface RiskPillProps {
  level: string
}

const levelMap: Record<string, { label: string; bg: string; color: string }> = {
  low: { label: '低', bg: '#e4f7ef', color: 'var(--green)' },
  medium: { label: '中', bg: '#fff3d9', color: 'var(--orange)' },
  high: { label: '高', bg: '#fde9e9', color: 'var(--red)' },
  critical: { label: '危', bg: '#fde9e9', color: 'var(--red)' }
}

export const RiskPill: React.FC<RiskPillProps> = ({ level }) => {
  const info = levelMap[level] || levelMap.medium
  return (
    <span
      className="risk-pill"
      style={{ background: info.bg, color: info.color }}
    >
      {info.label}
    </span>
  )
}
