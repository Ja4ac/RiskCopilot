import React, { useMemo } from 'react'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { Panel } from '@/components/ui/Panel'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Skeleton } from '@/components/ui/Skeleton'
import type {
  KlinePeriod,
  IndicatorType,
  WatchlistItemWithStatus,
  KlineBar,
  KlineFetchResult,
  KlineErrorCode,
} from '@shared/types/database'

// ── Constants ──

const PERIODS: { label: string; value: KlinePeriod }[] = [
  { label: '日K', value: '1d' },
  { label: '周K', value: '1w' },
  { label: '月K', value: '1M' },
]

const INDICATORS_OPTIONS: { key: IndicatorType; label: string; color: string }[] = [
  { key: 'MA', label: 'MA', color: '#d47706' },
  { key: 'MACD', label: 'MACD', color: '#2f65d9' },
  { key: 'BOLL', label: 'BOLL', color: '#078f8c' },
  { key: 'KDJ', label: 'KDJ', color: '#c99a05' },
]

// ── Types ──

type FundPerformanceData = {
  dates: string[]
  navs: number[]
  cumulativeReturns: number[]
} | null

interface KlinePanelProps {
  selectedItem: WatchlistItemWithStatus | null
  klineData: KlineBar[]
  period: KlinePeriod
  loading: boolean
  error: string | null
  klineErrorMessage: string | null
  klineErrorCode: KlineErrorCode
  klineSource: KlineFetchResult['source']
  klineCacheHit: boolean
  activeIndicators: IndicatorType[]
  fundPerformance: FundPerformanceData
  fundPerformanceLoading: boolean
  fundPerformanceRange: '1m' | '3m' | '6m' | '1y' | 'all'
  onPeriodChange: (p: string) => void
  onIndicatorToggle: (keyStr: string) => void
  onFundRangeChange: (range: '1m' | '3m' | '6m' | '1y' | 'all') => void
  onFetchKline: (assetId: string, period: KlinePeriod, force?: boolean) => void
}

export function KlinePanel({
  selectedItem,
  klineData,
  period,
  loading,
  error,
  klineErrorMessage,
  klineErrorCode,
  klineSource,
  klineCacheHit,
  activeIndicators,
  fundPerformance,
  fundPerformanceLoading,
  fundPerformanceRange,
  onPeriodChange,
  onIndicatorToggle,
  onFundRangeChange,
  onFetchKline,
}: KlinePanelProps) {
  const isFundSelected = selectedItem?.asset_type === 'fund'

  // ── K-line option ──
  const klineOption = useMemo(() => {
    if (!klineData.length) return {}
    // Show full date: YYYY-MM-DD or YYYY-MM for monthly
    const isMonthly = period === '1M'
    const dates = klineData.map((k) => k.bar_time.slice(0, isMonthly ? 7 : 10))
    const ohlc = klineData.map((k) => [k.open, k.close, k.low, k.high])
    const volumes = klineData.map((k) => k.volume ?? 0)
    // Debug: log what useMemo sees
    const lastOhlc = ohlc[ohlc.length - 1]
    console.log('[KlineMemo] count=', klineData.length, 'lastOHLC=', lastOhlc, 'from klineData[last].open=', klineData[klineData.length - 1]?.open)
    const turnovers = klineData.map((k) => (k.volume ?? 0) * k.close)
    const closes = klineData.map((k) => k.close)
    const highs = klineData.map((k) => k.high)
    const lows = klineData.map((k) => k.low)
    const upColor = '#d33f3f'
    const downColor = '#119468'
    const volumeColors = klineData.map((k) => (k.close >= k.open ? upColor : downColor))

    const mainSeries: unknown[] = [{
      name: 'K线', type: 'candlestick', data: ohlc,
      itemStyle: { color: upColor, color0: downColor, borderColor: upColor, borderColor0: downColor },
    }]

    if (activeIndicators.includes('MA')) {
      const calcMA = (dayCount: number) => {
        const result: (number | null)[] = []
        for (let i = 0; i < closes.length; i++) {
          if (i < dayCount - 1) { result.push(null); continue }
          let sum = 0
          for (let j = 0; j < dayCount; j++) sum += closes[i - j]
          result.push(+(sum / dayCount).toFixed(2))
        }
        return result
      }
      mainSeries.push({ name: 'MA5', type: 'line', data: calcMA(5), smooth: true, lineStyle: { color: '#2f65d9', width: 1 }, symbol: 'none' })
      mainSeries.push({ name: 'MA10', type: 'line', data: calcMA(10), smooth: true, lineStyle: { color: '#d47706', width: 1 }, symbol: 'none' })
      mainSeries.push({ name: 'MA20', type: 'line', data: calcMA(20), smooth: true, lineStyle: { color: '#c99a05', width: 1 }, symbol: 'none' })
    }

    if (activeIndicators.includes('BOLL')) {
      const period = 20, mult = 2
      const middle: (number | null)[] = [], upper: (number | null)[] = [], lower: (number | null)[] = []
      for (let i = 0; i < closes.length; i++) {
        if (i < period - 1) { middle.push(null); upper.push(null); lower.push(null); continue }
        const slice = closes.slice(i - period + 1, i + 1)
        const ma = slice.reduce((a, b) => a + b, 0) / period
        const std = Math.sqrt(slice.reduce((sq, n) => sq + (n - ma) ** 2, 0) / period)
        middle.push(+ma.toFixed(2)); upper.push(+(ma + mult * std).toFixed(2)); lower.push(+(ma - mult * std).toFixed(2))
      }
      mainSeries.push({ name: 'BOLL中轨', type: 'line', data: middle, smooth: true, lineStyle: { color: '#078f8c', width: 1, type: 'dashed' as const }, symbol: 'none' })
      mainSeries.push({ name: 'BOLL上轨', type: 'line', data: upper, smooth: true, lineStyle: { color: 'rgba(7,143,140,0.4)', width: 1 }, symbol: 'none' })
      mainSeries.push({ name: 'BOLL下轨', type: 'line', data: lower, smooth: true, lineStyle: { color: 'rgba(7,143,140,0.4)', width: 1 }, symbol: 'none' })
    }

    let subSeries: unknown[] = []
    if (activeIndicators.includes('MACD')) {
      const calcEMA = (data: number[], p: number): number[] => {
        const res: number[] = []; let e = data[0] ?? 0; const k = 2 / (p + 1)
        for (let i = 0; i < data.length; i++) { e = (data[i] ?? 0) * k + e * (1 - k); res.push(+e.toFixed(4)) }
        return res
      }
      const ema12 = calcEMA(closes, 12), ema26 = calcEMA(closes, 26)
      const dif = ema12.map((v, i) => +(v - ema26[i]).toFixed(4))
      const dea = calcEMA(dif, 9)
      const histogram = dif.map((v, i) => +((v - dea[i]) * 2).toFixed(4))
      subSeries = [
        { name: 'DIF', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: dif, smooth: true, lineStyle: { color: '#2f65d9', width: 1 }, symbol: 'none' },
        { name: 'DEA', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: dea, smooth: true, lineStyle: { color: '#d47706', width: 1 }, symbol: 'none' },
        { name: 'MACD', type: 'bar', xAxisIndex: 2, yAxisIndex: 2, data: histogram, itemStyle: { color: (params: any) => (params.value >= 0 ? upColor : downColor) } },
      ]
    }
    if (activeIndicators.includes('KDJ')) {
      const kValues: number[] = [], dValues: number[] = [], jValues: number[] = []
      let prevK = 50, prevD = 50
      for (let i = 0; i < closes.length; i++) {
        if (i < 8) { kValues.push(prevK); dValues.push(prevD); jValues.push(prevD); continue }
        const highest = Math.max(...highs.slice(i - 8, i + 1)), lowest = Math.min(...lows.slice(i - 8, i + 1))
        const rsv = highest === lowest ? 0 : ((closes[i] - lowest) / (highest - lowest)) * 100
        const currK = (2 / 3) * prevK + (1 / 3) * rsv, currD = (2 / 3) * prevD + (1 / 3) * currK, currJ = 3 * currK - 2 * currD
        kValues.push(+currK.toFixed(2)); dValues.push(+currD.toFixed(2)); jValues.push(+currJ.toFixed(2))
        prevK = currK; prevD = currD
      }
      subSeries = [
        { name: 'K', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: kValues, smooth: true, lineStyle: { color: '#2f65d9', width: 1 }, symbol: 'none' },
        { name: 'D', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: dValues, smooth: true, lineStyle: { color: '#d47706', width: 1 }, symbol: 'none' },
        { name: 'J', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: jValues, smooth: true, lineStyle: { color: '#c99a05', width: 1 }, symbol: 'none' },
      ]
    }

    const hasSub = subSeries.length > 0
    const grid: unknown[] = [
      { left: 56, right: 44, top: 28, height: hasSub ? '50%' : '60%' },
      { left: 56, right: 44, top: hasSub ? '58%' : '68%', height: '18%' },
    ]
    const xAxis: unknown[] = [
      { type: 'category' as const, data: dates, gridIndex: 0, axisLine: { lineStyle: { color: '#d8e1e8' } }, axisLabel: { show: false } },
      { type: 'category' as const, data: dates, gridIndex: 1, axisLine: { lineStyle: { color: '#d8e1e8' } }, axisLabel: { show: false } },
    ]
    const yAxis: unknown[] = [
      { type: 'value' as const, gridIndex: 0, scale: true, splitLine: { lineStyle: { color: '#eef2f5' } }, axisLabel: { color: '#6b7b8d' } },
      { type: 'value' as const, gridIndex: 1, axisLabel: { show: false }, splitLine: { show: false } },
    ]
    let dataZoomX: number[] = [0, 1]

    if (hasSub) {
      grid.push({ left: 56, right: 44, top: '80%', height: '18%' })
      xAxis.push({ type: 'category' as const, data: dates, gridIndex: 2, axisLine: { lineStyle: { color: '#d8e1e8' } }, axisLabel: { color: '#6b7b8d', fontSize: 10 } })
      yAxis.push({ type: 'value' as const, gridIndex: 2, axisLabel: { fontSize: 10, color: '#6b7b8d' }, splitLine: { lineStyle: { color: '#eef2f5' } } })
      dataZoomX = [0, 1, 2]
    }

    return {
      tooltip: {
        trigger: 'axis' as const,
        axisPointer: { type: 'cross' as const, label: { backgroundColor: '#6a7985', precision: 2, color: '#fff' } },
        backgroundColor: 'rgba(255,255,255,0.95)', borderColor: '#e2e8f0',
        textStyle: { color: '#334155', fontSize: 12 }, padding: [10, 14],
        extraCssText: 'box-shadow:0 4px 12px rgba(0,0,0,0.08);border-radius:8px;',
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params : [params]
          const candle = p.find((x: any) => x.seriesType === 'candlestick')
          const volumeSer = p.find((x: any) => x.seriesName === '成交量')
          const date = candle?.name ?? p[0]?.name ?? ''
          if (!candle) {
            // Show sub-chart data (MACD/KDJ/Volume) when hovering outside candlestick panel
            let html = `<div style="font-weight:700;margin-bottom:6px;font-size:13px;">${date}</div>`
            html += `<div style="font-size:12px;line-height:1.6;">`
            for (const s of p) {
              if (s.value == null) continue
              const val = typeof s.value === 'number' ? s.value.toFixed(3) : s.value
              html += `<div>${s.seriesName}: <b>${val}</b></div>`
            }
            html += `</div>`
            return html
          }
          // ECharts v5 sometimes prepends array index to candle data → [index, open, close, low, high]
          // Normal format: [open, close, low, high]
          const raw = candle.data as number[]
          const off = raw.length === 5 ? 1 : 0
          const o = raw[off]
          const c = raw[off + 1]
          const l = raw[off + 2]
          const h = raw[off + 3]
          const changePct = o > 0 ? ((c - o) / o) * 100 : 0
          const amplitude = o > 0 ? ((h - l) / o) * 100 : 0
          const idx = candle.dataIndex as number
          const vol = volumeSer ? Number(volumeSer.value) : (volumes[idx] ?? 0)
          const turnover = turnovers[idx] ?? 0
          let html = `<div style="font-weight:700;margin-bottom:6px;font-size:13px;">${date}</div>`
          html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;font-size:12px;line-height:1.6;">`
          html += `<div>开: <b>${o.toFixed(2)}</b></div>`
          html += `<div>收: <b style="color:${c >= o ? upColor : downColor}">${c.toFixed(2)}</b></div>`
          html += `<div>高: <b>${h.toFixed(2)}</b></div>`
          html += `<div>低: <b>${l.toFixed(2)}</b></div>`
          html += `<div>涨跌: <b style="color:${changePct >= 0 ? upColor : downColor}">${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%</b></div>`
          html += `<div>振幅: <b>${amplitude.toFixed(2)}%</b></div>`
          html += `<div>成交量: <b>${(vol / 10000).toFixed(0)}万</b></div>`
          html += `<div>成交额: <b>${(turnover / 10000).toFixed(0)}万</b></div>`
          p.filter((x: any) => x.seriesType === 'line' && (x.seriesName?.includes('MA') || x.seriesName?.includes('BOLL'))).forEach((l: any) => {
            html += `<div>${l.seriesName}: <b>${typeof l.value === 'number' ? l.value.toFixed(2) : l.value}</b></div>`
          })
          p.filter((x: any) => x.seriesType === 'line' && !x.seriesName?.includes('MA') && !x.seriesName?.includes('BOLL')).forEach((l: any) => {
            html += `<div>${l.seriesName}: <b>${typeof l.value === 'number' ? l.value.toFixed(3) : l.value}</b></div>`
          })
          html += `</div>`
          return html
        },
      },
      legend: {
        data: [...mainSeries.map((s: any) => s.name), '成交量', ...subSeries.map((s: any) => s.name)].filter(Boolean),
        top: 4, left: 'center', textStyle: { fontSize: 11, color: '#475569' }, itemWidth: 16, itemHeight: 8,
      },
      grid, xAxis, yAxis,
      dataZoom: [
        { type: 'inside' as const, xAxisIndex: dataZoomX, start: 60, end: 100 },
        { type: 'slider' as const, xAxisIndex: dataZoomX, bottom: 2, height: 16, borderColor: 'transparent', fillerColor: 'rgba(47,101,217,0.08)', handleStyle: { color: '#2f65d9' } },
      ],
      series: [
        ...mainSeries,
        { name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: volumes, itemStyle: { color: (_params: unknown) => volumeColors[(_params as { dataIndex: number }).dataIndex] } } as Record<string, unknown>,
        ...subSeries,
      ],
    }
  }, [klineData, activeIndicators, period])

  // ── Fund performance chart option ──
  const fundOption = useMemo(() => {
    if (!fundPerformance || fundPerformance.dates.length === 0) return {}
    const { dates, navs, cumulativeReturns } = fundPerformance
    return {
      tooltip: {
        trigger: 'axis' as const,
        backgroundColor: 'rgba(255,255,255,0.95)',
        borderColor: '#e2e8f0',
        textStyle: { color: '#334155', fontSize: 12 },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params : [params]
          const date = p[0]?.name ?? ''
          const nav = p.find((x: any) => x.seriesName === '单位净值')?.value ?? 0
          const ret = p.find((x: any) => x.seriesName === '累计收益')?.value ?? 0
          return `<div style="font-weight:700;margin-bottom:6px;font-size:13px;">${date}</div>
                  <div style="font-size:12px;line-height:1.6;">
                    <div>单位净值: <b>¥${nav.toFixed(4)}</b></div>
                    <div>累计收益: <b style="color:${ret >= 0 ? '#d33f3f' : '#119468'}">${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%</b></div>
                  </div>`
        },
      },
      legend: {
        data: ['单位净值', '累计收益'],
        top: 4,
        left: 'center',
        textStyle: { fontSize: 11, color: '#475569' },
      },
      grid: { left: 56, right: 56, top: 40, bottom: 40 },
      xAxis: {
        type: 'category' as const,
        data: dates,
        axisLine: { lineStyle: { color: '#d8e1e8' } },
        axisLabel: { color: '#6b7b8d', fontSize: 10 },
      },
      yAxis: [
        {
          type: 'value' as const,
          name: '净值',
          position: 'left',
          axisLabel: { color: '#6b7b8d', fontSize: 10, formatter: (v: number) => `¥${v.toFixed(3)}` },
          splitLine: { lineStyle: { color: '#eef2f5' } },
        },
        {
          type: 'value' as const,
          name: '收益%',
          position: 'right',
          axisLabel: { color: '#6b7b8d', fontSize: 10, formatter: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: '单位净值',
          type: 'line',
          data: navs,
          smooth: true,
          symbol: 'none',
          lineStyle: { color: '#2f65d9', width: 2 },
          itemStyle: { color: '#2f65d9' },
          yAxisIndex: 0,
        },
        {
          name: '累计收益',
          type: 'line',
          data: cumulativeReturns,
          smooth: true,
          symbol: 'none',
          lineStyle: { color: '#078f8c', width: 1.5, type: 'dashed' as const },
          itemStyle: { color: '#078f8c' },
          yAxisIndex: 1,
        },
      ],
    }
  }, [fundPerformance])

  // ── Render ──
  if (!selectedItem) return null

  if (isFundSelected) {
    return (
      <Panel
        title="业绩走势"
        subtitle={`${selectedItem.name} (${selectedItem.symbol})`}
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {(['1m', '3m', '6m', '1y', 'all'] as const).map((r) => (
              <button
                key={r}
                className={`text-button ${fundPerformanceRange === r ? 'selected' : ''}`}
                onClick={() => onFundRangeChange(r)}
                style={{
                  fontSize: 12,
                  padding: '2px 8px',
                  background: fundPerformanceRange === r ? '#2f65d9' : undefined,
                  color: fundPerformanceRange === r ? '#fff' : undefined,
                }}
              >
                {r === '1m' ? '1月' : r === '3m' ? '3月' : r === '6m' ? '6月' : r === '1y' ? '1年' : '成立来'}
              </button>
            ))}
          </div>
        }
      >
        {fundPerformanceLoading ? (
          <Skeleton height={400} />
        ) : !fundPerformance || fundPerformance.dates.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)' }}>
            <p>暂无业绩数据</p>
            <p style={{ fontSize: 12, marginTop: 4 }}>正在同步基金历史净值...</p>
          </div>
        ) : (
          <ReactEChartsCore echarts={echarts} option={fundOption} style={{ height: 400, width: '100%' }} notMerge />
        )}
      </Panel>
    )
  }

  return (
    <Panel
      title="K线图"
      subtitle={
        <span>
          {`${selectedItem.name} (${selectedItem.symbol})`}
          {klineErrorMessage && klineData.length === 0 && (
            <span style={{ marginLeft: 8, fontSize: 11, color: '#d33f3f' }}>
              [{klineErrorCode === 'PROXY_UNAVAILABLE' ? '数据源未就绪' :
                klineErrorCode === 'PROXY_ERROR' ? '数据源异常' :
                klineErrorCode === 'UNSUPPORTED_MARKET' ? '不支持' :
                klineErrorCode === 'NO_DATA' ? '无数据' : '错误'}]
            </span>
          )}
        </span>
      }
      actions={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <SegmentedControl options={PERIODS.map((p) => ({ label: p.label, value: p.value }))} selected={period} onChange={onPeriodChange} />
        </div>
      }
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Data source status badge */}
        {klineSource !== 'none' && (
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 4,
            background: klineCacheHit ? 'rgba(17,148,104,0.1)' : 'rgba(47,101,217,0.1)',
            color: klineCacheHit ? '#119468' : '#2f65d9',
            marginRight: 4,
          }}>
            {klineCacheHit ? '缓存' : klineSource === 'proxy' ? 'Python代理' : klineSource === 'provider' ? '备用数据源' : ''}
          </span>
        )}
        {klineErrorMessage && klineData.length === 0 && (
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 4,
            background: 'rgba(211,63,63,0.1)', color: '#d33f3f', marginRight: 4,
            cursor: 'help',
          }} title={klineErrorMessage}>
            {klineErrorCode === 'PROXY_UNAVAILABLE' ? 'Python未启动' :
             klineErrorCode === 'PROXY_ERROR' ? '代理异常' :
             klineErrorCode === 'UNSUPPORTED_MARKET' ? '不支持' : '错误'}
          </span>
        )}
        {INDICATORS_OPTIONS.map((ind) => (
          <button
            key={ind.key}
            className="text-button"
            onClick={() => onIndicatorToggle(ind.key)}
            style={{
              background: activeIndicators.includes(ind.key) ? ind.color : undefined,
              color: activeIndicators.includes(ind.key) ? '#fff' : undefined,
            }}
          >
            {ind.label}
          </button>
        ))}
      </div>
      {loading && klineData.length === 0 ? (
        <Skeleton height={400} />
      ) : (klineErrorMessage || error) && klineData.length === 0 ? (
        <div className="alert-item severe" style={{ margin: 16 }}>
          <b>K线数据加载失败</b>
          <p>{klineErrorMessage || error}</p>
          {klineErrorCode === 'PROXY_UNAVAILABLE' && (
            <p style={{ fontSize: 12, marginTop: 4 }}>
              请确保已安装Python环境，并运行 <code>pip install -r python-proxy/requirements.txt</code>
            </p>
          )}
          <button
            className="primary-button"
            onClick={() => selectedItem && onFetchKline(selectedItem.asset_id, period)}
            style={{ marginTop: 8 }}
          >
            重试
          </button>
        </div>
      ) : klineData.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)' }}>
          <p>暂无K线数据</p>
          <p style={{ fontSize: 12, marginTop: 4, marginBottom: 12 }}>正在从数据源获取...</p>
          <button
            className="primary-button"
            onClick={() => {
              if (!selectedItem) return
              onFetchKline(selectedItem.asset_id, period)
            }}
            style={{ fontSize: 13 }}
          >
            加载K线数据
          </button>
        </div>
      ) : (
        <>
          {/* Debug: show latest OHLC directly from data */}
          {klineData.length > 0 && (() => {
            const last = klineData[klineData.length - 1]
            const first = klineData[0]
            return (
              <div style={{ fontSize: 11, color: 'var(--muted)', padding: '4px 0', display: 'flex', gap: 16 }}>
                <span>数据条数: {klineData.length}</span>
                <span>最新: O={last.open} H={last.high} L={last.low} C={last.close}</span>
                <span>最早: O={first.open} C={first.close} 日期={first.bar_time}</span>
              </div>
            )
          })()}
          <ReactEChartsCore key={'k-' + klineData.length + '-' + klineData[klineData.length-1]?.open + '-' + klineData[0]?.bar_time + '-' + Date.now()} echarts={echarts} option={{ ...klineOption }} style={{ height: 400, width: '100%' }} notMerge opts={{ notMerge: true }} />
        </>
      )}
    </Panel>
  )
}
