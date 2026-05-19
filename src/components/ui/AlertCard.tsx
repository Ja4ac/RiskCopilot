import React from 'react'

interface AlertData {
  id: string
  title: string
  description: string
  severity: 'severe' | 'warning'
  time: string
}

interface AlertCardProps {
  alert: AlertData
  onAcknowledge?: (id: string) => void
}

export const AlertCard: React.FC<AlertCardProps> = ({ alert, onAcknowledge }) => {
  const className = alert.severity === 'severe' ? 'alert-item severe' : 'alert-item'
  return (
    <div className={className}>
      <b>{alert.title}</b>
      <p>{alert.description}</p>
      <p style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>{alert.time}</p>
    </div>
  )
}
