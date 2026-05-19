import React, { useEffect, useState, useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import ReactECharts from 'echarts-for-react'
import { ipcInvoke } from '@/hooks/useIPC'
import { IPC_CHANNELS } from '@/types'
import { Skeleton } from '@/components/ui/Skeleton'

interface PortfolioChartProps {
  mode: '1M' | '6M' | '1Y' | 'ALL'
  onModeChange: (mode: '1M' | '6M' | '1Y' | 'ALL') => void
}

const RANGE_MAP: Record<string, '1m' | '6m' | '1y' | 'all'> = {
  '1M': '1m',
  '6M': '6m',
  '1Y': '1y',
  'ALL': 'all',
}

export function PortfolioChart({ mode, onModeChange }: PortfolioChartProps) {
  const [data, setData] = useState<{
    dates: string[]
    values: number[]
    cumulativeReturns: number[]
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    ipcInvoke<{ dates: string[]; values: number[]; cumulativeReturns: number[] }>(
      IPC_CHANNELS.PORTFOLIO_GET_PORTFOLIO_PERFORMANCE,
      RANGE_MAP[mode]
    )
      .then((result) => {
        if (result && Array.isArray(result.dates)) {
          setData(result)
        } else {
          setData(null)
        }
      })
      .catch((e) => setError(e.message || '加载失败'))
      .finally(() => setLoading(false))
  }, [mode])

  const { dates, cumulativeReturns } = data ?? { dates: [], cumulativeReturns: [] }

  const option: EChartsOption = useMemo(
    () => ({
      grid: {
        top: 20,
        right: 20,
        bottom: 30,
        left: 55
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { show: true, lineStyle: { color: '#e8edf3' } },
        axisTick: { show: false },
        axisLabel: {
          color: '#687887',
          fontSize: 11,
          interval: 0,
          rotate: dates.length > 10 ? 45 : 0,
          margin: 8,
        },
        splitLine: { show: false }
      },
      yAxis: {
        type: 'value',
        min: (value: any) => {
          const absMax = Math.max(Math.abs(value?.min ?? 0), Math.abs(value?.max ?? 0))
          const margin = absMax < 20 ? Math.max(2, absMax * 0.3) : absMax * 0.15
          const rawMin = (value?.min ?? -margin) - margin
          // Round down to nearest integer
          return Math.floor(rawMin)
        },
        max: (value: any) => {
          const absMax = Math.max(Math.abs(value?.min ?? 0), Math.abs(value?.max ?? 0))
          const margin = absMax < 20 ? Math.max(2, absMax * 0.3) : absMax * 0.15
          const rawMax = (value?.max ?? margin) + margin
          return Math.ceil(rawMax)
        },
        splitNumber: 6,
        axisLabel: {
          color: '#687887',
          fontSize: 11,
          formatter: (v: number) => {
            if (v === 0) return '0%'
            return `${v >= 0 ? '+' : ''}${v}%`
          },
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: '#e8edf3',
            type: 'dashed',
            width: 1,
          }
        },
        axisLine: { show: false },
        axisTick: { show: false },
        // Highlight the 0 line with a solid, slightly thicker line
        minorSplitLine: { show: false },
      },
      series: [
        // Portfolio cumulative return with drawdown area.
        {
          name: '组合收益',
          type: 'line',
          data: cumulativeReturns,
          smooth: true,
          symbol: 'none',
          lineStyle: {
            color: '#2f65d9',
            width: 2
          },
          itemStyle: { color: '#2f65d9' },
          // Emphasize the 0% line
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: {
              color: '#334155',
              width: 1.5,
              type: 'solid',
            },
            label: {
              show: false,
            },
            data: [
              {
                yAxis: 0,
              },
            ],
          },
          // Shade area below 0% to show drawdown
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(211, 63, 63, 0.0)' },
                { offset: 0.5, color: 'rgba(211, 63, 63, 0.0)' },
                { offset: 0.5, color: 'rgba(211, 63, 63, 0.06)' },
                { offset: 1, color: 'rgba(211, 63, 63, 0.12)' },
              ],
            }
          }
        }
      ],
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(20, 36, 51, 0.92)',
        borderColor: 'transparent',
        textStyle: { color: '#fff', fontSize: 12 },
        formatter: (params: any) => {
          if (!Array.isArray(params)) return ''
          const p = params.filter((p: any) => p.seriesName)
          const dateStr = p[0]?.axisValue ?? ''
          return p
            .map(
              (item: any) =>
                `<div style="font-weight:600;margin-bottom:4px;font-size:13px;">${dateStr}</div>` +
                `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${item.color};margin-right:6px;"></span>${
                  item.seriesName
                }: <b style="font-size:14px;${item.value >= 0 ? 'color:#d33f3f' : 'color:#119468'}">${item.value >= 0 ? '+' : ''}${item.value}%</b>`
            )
            .join('<br/>')
        }
      }
    }),
    [dates, cumulativeReturns]
  )

  const periods: ('1M' | '6M' | '1Y' | 'ALL')[] = ['1M', '6M', '1Y', 'ALL']

  return (
    <div className="panel" style={{ minHeight: 360 }}>
      <div className="panel-header">
        <div>
          <h2>组合收益走势</h2>
          <p>累计收益率</p>
        </div>
        <div className="segmented">
          {periods.map((p) => (
            <button
              key={p}
              className={mode === p ? 'selected' : ''}
              onClick={() => onModeChange(p)}
            >
              {p === 'ALL' ? '买入来' : p}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 8, fontSize: 12, color: 'var(--muted)' }}>
        <span>
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: '#2f65d9',
              marginRight: 6,
              verticalAlign: 'middle'
            }}
          />
          组合收益
        </span>
      </div>

      <div className="chart-container" style={{ height: 302 }}>
        {loading ? (
          <Skeleton height={302} />
        ) : error ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)' }}>
            <p>数据加载失败</p>
            <p style={{ fontSize: 12, marginTop: 4 }}>{error}</p>
          </div>
        ) : !data || data.dates.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)' }}>
            <p>暂无收益走势数据</p>
            <p style={{ fontSize: 12, marginTop: 4 }}>添加交易后将自动记录收益走势</p>
          </div>
        ) : (
          <ReactECharts
            option={option}
            style={{ height: '100%', width: '100%' }}
            notMerge
            lazyUpdate
          />
        )}
      </div>
    </div>
  )
}
