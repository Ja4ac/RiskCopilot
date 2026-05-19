import React from 'react'

interface CountBadgeProps {
  count: number
}

export const CountBadge: React.FC<CountBadgeProps> = ({ count }) => {
  if (count <= 0) return null
  return <span className="count-badge">{count > 99 ? '99+' : count}</span>
}
