import { useState, useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { Panel } from '../ui/Panel'
import { SegmentedControl } from '../ui/SegmentedControl'

type ChartPeriod = '1M' | '6M' | '1Y' | 'ALL'

/* ── Deterministic seeded PRNG (same algo as mock-provider) ── */
function seedRand(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

/* ── Generate chart data based on selected period ──
 * 1M  -> daily points   (~30 points)
 * 6M  -> weekly points  (~26 points)
 * 1Y  -> biweekly points(~26 points)
 * ALL -> monthly points (~24 points)
 */
function generateChartData(period: ChartPeriod) {
  const seed = hashCode(period) + 2024
  const rand = seedRand(seed)

  const months = period === '1M' ? 1 : period === '6M' ? 6 : period === '1Y' ? 12 : 24
  const intervalDays = period === '1M' ? 1 : period === '6M' ? 7 : period === '1Y' ? 14 : 30
  const totalDays = months * 30
  const numPoints = Math.max(6, Math.floor(totalDays / intervalDays))

  const dates: string[] = []
  const portfolioReturns: number[] = []
  const benchmarkReturns: number[] = []
  const drawdownData: number[] = []

  let portfolioVal = 100
  let benchmarkVal = 100
  let peak = 100

  const now = new Date()

  for (let i = 0; i < numPoints; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - (numPoints - 1 - i) * intervalDays)

    // Format date label based on interval
    if (intervalDays >= 30) {
      dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    } else if (intervalDays >= 7) {
      dates.push(`${d.getMonth() + 1}/${d.getDate()}`)
    } else {
      dates.push(`${d.getMonth() + 1}/${d.getDate()}`)
    }

    // Random walk with different volatility per period
    const volScale = intervalDays >= 30 ? 4 : intervalDays >= 14 ? 2.5 : intervalDays >= 7 ? 1.5 : 0.6
    const portfolioChange = (rand() - 0.48) * volScale
    const benchmarkChange = (rand() - 0.5) * volScale * 0.7

    portfolioVal += portfolioChange
    benchmarkVal += benchmarkChange

    // Ensure prices don't go negative
    portfolioVal = Math.max(portfolioVal, 20)
    benchmarkVal = Math.max(benchmarkVal, 20)

    if (portfolioVal > peak) peak = portfolioVal
    const dd = peak > 0 ? (peak - portfolioVal) / peak : 0

    portfolioReturns.push(Number(((portfolioVal - 100)).toFixed(2)))
    benchmarkReturns.push(Number(((benchmarkVal - 100)).toFixed(2)))
    drawdownData.push(Number((-dd * 100).toFixed(2)))
  }

  return { dates, portfolioReturns, benchmarkReturns, drawdownData }
}

export function PortfolioChartPanel() {
  const [period, setPeriod] = useState<ChartPeriod>('6M')

  const { dates, portfolioReturns, benchmarkReturns, drawdownData } = useMemo(
    () => generateChartData(period),
    [period]
  )

  const option = useMemo(() => ({
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(20, 36, 51, 0.92)',
      borderColor: 'transparent',
      textStyle: { color: '#fff', fontSize: 12 },
      formatter: (params: any) => {
        if (!Array.isArray(params)) return ''
        const dateStr = params[0]?.axisValue ?? ''
        const lines = params
          .filter((p: any) => p.seriesName && p.seriesName !== '回撤区间')
          .map(
            (item: any) =>
              `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${item.color};margin-right:6px;"></span>${
                item.seriesName
              }: <b>${item.value >= 0 ? '+' : ''}${item.value}%</b>`
          )
        // Add drawdown info
        const ddItem = params.find((p: any) => p.seriesName === '回撤区间')
        if (ddItem) {
          lines.push(
            `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#d33f3f;margin-right:6px;"></span>回撤: <b>${Math.abs(ddItem.value).toFixed(2)}%</b>`
          )
        }
        return `<div style="font-weight:700;margin-bottom:4px">${dateStr}</div>` + lines.join('<br/>')
      },
    },
    legend: {
      data: ['组合收益', '沪深300', '回撤区间'],
      bottom: 0,
      textStyle: { fontSize: 12, color: '#687887' },
    },
    grid: { left: 50, right: 20, top: 20, bottom: 40 },
    xAxis: {
      type: 'category',
      data: dates,
      axisLine: { lineStyle: { color: '#d8e1e8' } },
      axisLabel: {
        color: '#687887',
        fontSize: 11,
        interval: Math.max(0, Math.floor(dates.length / 6) - 1),
      },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: '#687887',
        fontSize: 11,
        formatter: (v: number) => `${v >= 0 ? '+' : ''}${v}%`,
      },
      splitLine: { lineStyle: { color: '#eef2f5' } },
    },
    series: [
      {
        name: '组合收益',
        type: 'line',
        data: portfolioReturns,
        smooth: true,
        lineStyle: { color: '#2f65d9', width: 2 },
        itemStyle: { color: '#2f65d9' },
        symbol: 'circle',
        symbolSize: 4,
      },
      {
        name: '沪深300',
        type: 'line',
        data: benchmarkReturns,
        smooth: true,
        lineStyle: { color: '#078f8c', width: 2 },
        itemStyle: { color: '#078f8c' },
        symbol: 'circle',
        symbolSize: 4,
      },
      {
        name: '回撤区间',
        type: 'line',
        data: drawdownData,
        smooth: true,
        lineStyle: { color: '#d33f3f', width: 1, type: 'dashed' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(211,63,63,0.12)' },
              { offset: 1, color: 'rgba(211,63,63,0.02)' },
            ],
          },
        },
        itemStyle: { color: '#d33f3f' },
        symbol: 'none',
      },
    ],
  }), [dates, portfolioReturns, benchmarkReturns, drawdownData])

  const handlePeriodChange = (value: string) => {
    setPeriod(value as ChartPeriod)
  }

  return (
    <Panel
      title="组合收益与回撤"
      actions={
        <SegmentedControl
          options={[
            { label: '1M', value: '1M' },
            { label: '6M', value: '6M' },
            { label: '1Y', value: '1Y' },
            { label: 'ALL', value: 'ALL' },
          ]}
          selected={period}
          onChange={handlePeriodChange}
        />
      }
    >
      <div className="chart-container">
        <ReactECharts option={option} style={{ height: 280 }} />
      </div>
      <div style={{ display: 'flex', gap: 20, marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
        <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#2f65d9', marginRight: 6 }} />组合收益</span>
        <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#078f8c', marginRight: 6 }} />沪深300</span>
        <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#d33f3f', marginRight: 6 }} />回撤区间</span>
      </div>
    </Panel>
  )
}
