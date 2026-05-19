import React, { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import ReactECharts from 'echarts-for-react'

export interface AllocationSegment {
  name: string
  value: number
  color: string
  className: string
}

interface AllocationDonutProps {
  segments: AllocationSegment[]
  centerLabel?: string
  loading?: boolean
}

export function AllocationDonut({
  segments,
  centerLabel = '配置',
  loading = false
}: AllocationDonutProps) {
  const option: EChartsOption = useMemo(
    () => ({
      series: [
        {
          type: 'pie',
          radius: ['55%', '78%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderColor: '#fff',
            borderWidth: 2,
            borderRadius: 3
          },
          label: { show: false },
          emphasis: {
            scaleSize: 6,
            label: { show: false }
          },
          data: segments.map((s) => ({
            name: s.name,
            value: s.value,
            itemStyle: { color: s.color }
          }))
        }
      ],
      graphic: {
        type: 'text',
        left: 'center',
        top: 'center',
        style: {
          text: centerLabel,
          textAlign: 'center',
          fill: '#687887',
          fontSize: 12,
          fontWeight: 900
        }
      }
    }),
    [segments, centerLabel]
  )

  if (loading) {
    return (
      <div className="panel">
        <div className="panel-header">
          <h2>资产配置</h2>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div className="skeleton" style={{ width: 126, height: 126, borderRadius: '50%' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 18, borderRadius: 6 }} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>资产配置</h2>
      </div>
      <div className="donut-wrap">
        <div style={{ width: 126, height: 126 }}>
          <ReactECharts
            option={option}
            style={{ height: '100%', width: '100%' }}
            notMerge
            lazyUpdate
          />
        </div>
        <ul className="legend">
          {segments.map((seg) => (
            <li key={seg.name}>
              <span className={`swatch ${seg.className}`} />
              {seg.name} {seg.value}%
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
