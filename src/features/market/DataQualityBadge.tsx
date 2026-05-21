import React from 'react'
import type { DataQualityStatus } from '@shared/types/database'

export function DataQualityBadge({ quality }: { quality: DataQualityStatus }) {
  const { confidence, staleness_ms } = quality
  const color = confidence === 'high' ? '#119468' : confidence === 'medium' ? '#c99a05' : '#d33f3f'
  const label = confidence === 'high' ? '实时' : confidence === 'medium' ? '延迟' : '陈旧'
  const minutes = Math.floor((staleness_ms ?? 0) / 60000)
  const timeLabel = minutes < 1 ? '<1分钟' : minutes < 60 ? `${minutes}分钟` : `${Math.floor(minutes / 60)}小时`

  return (
    <span
      title={`数据源: ${quality.source} | 更新: ${quality.source_time} | 延迟: ${timeLabel}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 10,
        padding: '1px 6px',
        borderRadius: 4,
        background: `${color}15`,
        color,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: color }} />
      {label}
    </span>
  )
}
