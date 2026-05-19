import React, { useEffect, useState, useMemo, useCallback } from 'react'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { CandlestickChart, BarChart, LineChart } from 'echarts/charts'
import {
  GridComponent, TooltipComponent, DataZoomComponent, MarkLineComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { useMarketStore } from '@/stores/market.store'
import { ipcInvoke } from '@/hooks/useIPC'
import { IPC_CHANNELS } from '@/types'
import { Panel } from '@/components/ui/Panel'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Skeleton } from '@/components/ui/Skeleton'
import type {
  KlinePeriod, IndicatorType, DataQualityStatus,
  WatchlistItemWithStatus, InstrumentListing,
} from '@shared/types/database'

// ── ECharts setup ──

echarts.use([
  CandlestickChart, BarChart, LineChart,
  GridComponent, TooltipComponent, DataZoomComponent, MarkLineComponent,
  CanvasRenderer,
])

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

const ASSET_TYPE_LABEL: Record<string, string> = {
  stock: '股票',
  fund: '基金',
  etf: 'ETF',
  lof: 'LOF',
  index: '指数',
  bond: '债券',
  convertible_bond: '可转债',
  money_market_fund: '货币基金',
  qdii: 'QDII',
  reit: 'REIT',
  cash: '现金',
  other: '其他',
}

// ── Data Quality Badge ──

function DataQualityBadge({ quality }: { quality: DataQualityStatus }) {
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

// ── Main Component ──

export function MarketPage() {
  const {
    klineData, indicators: indicatorData, period, loading, error,
    fetchKline, fetchIndicators, setPeriod, selectedAssetId, setSelectedAssetId,
  } = useMarketStore()

  // ── Search state ──
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<InstrumentListing[]>([])
  const [searchLoading, setSearchLoading] = useState(false)

  // ── Watchlist state ──
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItemWithStatus[]>([])
  const [watchlistLoading, setWatchlistLoading] = useState(false)

  // ── Selection & chart state ──
  const [selectedItem, setSelectedItem] = useState<WatchlistItemWithStatus | null>(null)
  const [activeIndicators, setActiveIndicators] = useState<IndicatorType[]>(['MA'])
  const [message, setMessage] = useState<string | null>(null)

  // ── Fund performance state ──
  const [fundPerformance, setFundPerformance] = useState<{
    dates: string[]
    navs: number[]
    cumulativeReturns: number[]
  } | null>(null)
  const [fundPerformanceLoading, setFundPerformanceLoading] = useState(false)
  const [fundPerformanceRange, setFundPerformanceRange] = useState<'1m' | '3m' | '6m' | '1y' | 'all'>('1y')

  const isFundSelected = selectedItem?.asset_type === 'fund'

  // ── Fetch watchlist ──
  const fetchWatchlist = useCallback(async () => {
    setWatchlistLoading(true)
    try {
      const items = await ipcInvoke<WatchlistItemWithStatus[]>(IPC_CHANNELS.WATCHLIST_LIST)
      setWatchlistItems(items ?? [])
    } catch (e: any) {
      setMessage(`自选列表加载失败: ${e.message || '未知错误'}`)
    } finally {
      setWatchlistLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchWatchlist()
  }, [fetchWatchlist])

  // ── Handle dashboard click-through ──
  useEffect(() => {
    if (selectedAssetId && watchlistItems.length > 0) {
      const item = watchlistItems.find((w) => w.asset_id === selectedAssetId)
      if (item) {
        setSelectedItem(item)
        fetchKline(item.asset_id, period)
        fetchIndicators(item.asset_id, period, activeIndicators)
      }
      // Clear after handling so re-navigation doesn't re-trigger
      setSelectedAssetId(null)
    }
  }, [selectedAssetId, watchlistItems, fetchKline, fetchIndicators, period, activeIndicators, setSelectedAssetId])

  // ── Auto-select first watchlist item if none selected ──
  useEffect(() => {
    if (watchlistItems.length > 0 && !selectedItem && !selectedAssetId) {
      const first = watchlistItems[0]
      setSelectedItem(first)
      if (first.asset_type !== 'fund') {
        fetchKline(first.asset_id, period)
        fetchIndicators(first.asset_id, period, activeIndicators)
      }
    }
  }, [watchlistItems, selectedItem, selectedAssetId, fetchKline, fetchIndicators, period, activeIndicators])

  // ── Search handler ──
  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query)
    if (!query.trim()) {
      setSearchResults([])
      return
    }
    setSearchLoading(true)
    try {
      const data = await ipcInvoke<{
        results: { listing: InstrumentListing; quality: DataQualityStatus }[]
        total: number
        fallbackUsed: boolean
      }>(IPC_CHANNELS.INSTRUMENT_SEARCH, {
        query: query.trim(),
        limit: 20,
      })
      setSearchResults(data?.results?.map((r) => r.listing) ?? [])
    } catch (e: any) {
      // silently fail — UI stays empty
    } finally {
      setSearchLoading(false)
    }
  }, [])

  // ── Add to watchlist ──
  const handleAddWatchlist = async (item: InstrumentListing) => {
    try {
      await ipcInvoke<WatchlistItemWithStatus>(IPC_CHANNELS.WATCHLIST_ADD, {
        symbol: item.symbol,
        market: item.market,
        name: item.name,
        asset_type: item.asset_type,
        origin: 'manual',
      })
      setSearchResults((prev) => prev.filter((r) => r.symbol !== item.symbol || r.market !== item.market))
      fetchWatchlist()
      setMessage(`已将 ${item.name} 加入自选`)
      setTimeout(() => setMessage(null), 3000)
    } catch (e: any) {
      setMessage(`加入自选失败: ${e.message || '未知错误'}`)
    }
  }

  // ── Remove from watchlist ──
  const handleRemove = async (assetId: string) => {
    try {
      const data = await ipcInvoke<{ removed: boolean; archived: boolean; reason?: string }>(
        IPC_CHANNELS.WATCHLIST_REMOVE,
        { asset_id: assetId }
      )
      if (data.archived) {
        setMessage(data.reason || '该标的仍有持仓，已归档')
      } else {
        setMessage('已移除自选')
      }
      fetchWatchlist()
      if (selectedItem?.asset_id === assetId) {
        setSelectedItem(null)
      }
      setTimeout(() => setMessage(null), 3000)
    } catch (e: any) {
      setMessage(`移除失败: ${e.message || '未知错误'}`)
    }
  }

  // ── Select item & fetch K-line or fund performance ──
  const handleSelect = useCallback(
    async (item: WatchlistItemWithStatus) => {
      setSelectedItem(item)
      if (item.asset_type === 'fund') {
        setFundPerformanceLoading(true)
        try {
          const data = await ipcInvoke<{
            dates: string[]
            navs: number[]
            cumulativeReturns: number[]
          }>(IPC_CHANNELS.PORTFOLIO_GET_FUND_PERFORMANCE, {
            symbol: item.symbol,
            market: item.market,
            range: fundPerformanceRange,
          })
          setFundPerformance(data)
        } catch (e: any) {
          const errorMsg = e?.message || '未知错误'
          console.error(`[MarketPage] Fund performance load failed:`, e)
          setMessage(`基金业绩数据加载失败: ${errorMsg === 'undefined' ? '服务器返回错误' : errorMsg}`)
        } finally {
          setFundPerformanceLoading(false)
        }
      } else {
        fetchKline(item.asset_id, period)
        fetchIndicators(item.asset_id, period, activeIndicators)
      }
    },
    [fetchKline, fetchIndicators, period, activeIndicators, fundPerformanceRange]
  )

  // ── Period / Indicator handlers ──
  const handlePeriodChange = useCallback(
    (p: string) => {
      const kp = p as KlinePeriod
      setPeriod(kp)
      if (selectedItem && selectedItem.asset_type !== 'fund') {
        fetchKline(selectedItem.asset_id, kp)
        fetchIndicators(selectedItem.asset_id, kp, activeIndicators)
      }
    },
    [selectedItem, activeIndicators, fetchKline, fetchIndicators, setPeriod]
  )

  const handleFundRangeChange = useCallback(
    async (range: '1m' | '3m' | '6m' | '1y' | 'all') => {
      setFundPerformanceRange(range)
      if (selectedItem && selectedItem.asset_type === 'fund') {
        setFundPerformanceLoading(true)
        try {
          const data = await ipcInvoke<{
            dates: string[]
            navs: number[]
            cumulativeReturns: number[]
          }>(IPC_CHANNELS.PORTFOLIO_GET_FUND_PERFORMANCE, {
            symbol: selectedItem.symbol,
            market: selectedItem.market,
            range,
          })
          setFundPerformance(data)
        } catch (e: any) {
          const errorMsg = e?.message || '未知错误'
          console.error(`[MarketPage] Fund performance load failed:`, e)
          setMessage(`基金业绩数据加载失败: ${errorMsg === 'undefined' ? '服务器返回错误' : errorMsg}`)
        } finally {
          setFundPerformanceLoading(false)
        }
      }
    },
    [selectedItem]
  )

  const toggleIndicator = useCallback(
    (keyStr: string) => {
      const key = keyStr as IndicatorType
      setActiveIndicators((prev) => {
        const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
        if (selectedItem && next.length > 0) {
          fetchIndicators(selectedItem.asset_id, period, next)
        }
        return next
      })
    },
    [selectedItem, fetchIndicators, period]
  )

  // ── K-line option (preserved professional layout) ──
  const klineOption = useMemo(() => {
    if (!klineData.length) return {}
    const dates = klineData.map((k) => k.bar_time.slice(5, 10))
    const ohlc = klineData.map((k) => [k.open, k.close, k.low, k.high])
    const volumes = klineData.map((k) => k.volume ?? 0)
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
          if (!candle) return date
          const [o, c, l, h] = candle.data as number[]
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
  }, [klineData, activeIndicators])

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

  // ── Single asset refresh handlers ──
  const handleForceRefresh = useCallback(async (item: WatchlistItemWithStatus) => {
    setMessage(`正在强制刷新 ${item.name}...`)
    try {
      if (item.asset_type === 'fund') {
        const data = await ipcInvoke<{
          dates: string[]
          navs: number[]
          cumulativeReturns: number[]
        }>(IPC_CHANNELS.PORTFOLIO_GET_FUND_PERFORMANCE, {
          symbol: item.symbol,
          market: item.market,
          range: fundPerformanceRange,
        })
        setFundPerformance(data)
      } else {
        // Force: skip DB cache, fetch from proxy
        await fetchKline(item.asset_id, period, true)
      }
      setMessage(`${item.name} 强制刷新完成`)
    } catch (e: any) {
      setMessage(`强制刷新 ${item.name} 失败: ${e.message || '未知错误'}`)
    }
    setTimeout(() => setMessage(null), 3000)
  }, [fetchKline, fundPerformanceRange, period])

  const handleTodayRefresh = useCallback(async (item: WatchlistItemWithStatus) => {
    setMessage(`正在刷新 ${item.name} 今日数据...`)
    try {
      if (item.asset_type === 'fund') {
        const data = await ipcInvoke<{
          dates: string[]
          navs: number[]
          cumulativeReturns: number[]
        }>(IPC_CHANNELS.PORTFOLIO_GET_FUND_PERFORMANCE, {
          symbol: item.symbol,
          market: item.market,
          range: '1m',
        })
        setFundPerformance(data)
      } else {
        await fetchKline(item.asset_id, period)
      }
      setMessage(`${item.name} 今日数据已刷新`)
    } catch (e: any) {
      setMessage(`刷新 ${item.name} 失败: ${e.message || '未知错误'}`)
    }
    setTimeout(() => setMessage(null), 3000)
  }, [fetchKline, fundPerformanceRange, period])

  // ── Derived state ──
  const holdingItems = watchlistItems.filter((i) => i.has_position)
  const watchingItems = watchlistItems.filter((i) => !i.has_position)

  // ── Render ──
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflow: 'auto' }}>
      {/* Message toast */}
      {message && (
        <div style={{
          padding: '8px 12px', borderRadius: 6, fontSize: 13,
          background: message.includes('失败') ? 'rgba(211,63,63,0.08)' : 'rgba(17,148,104,0.08)',
          color: message.includes('失败') ? '#d33f3f' : '#119468',
        }}>
          {message}
        </div>
      )}

      {/* Search Panel */}
      <Panel title="发现标的" subtitle="搜索代码、名称或拼音，点击加入自选">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
          <input
            type="text"
            placeholder="输入代码、名称或拼音（如 600519、贵州茅台、mt）..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            style={{ height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 12px', fontSize: 13, background: 'var(--surface)', flex: 1, minWidth: 220 }}
          />
          {searchLoading && <Skeleton width={60} height={14} />}
        </div>

        {searchResults.length > 0 && (
          <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
            <table className="holding-table">
              <thead>
                <tr>
                  <th>代码</th>
                  <th>名称</th>
                  <th>类型</th>
                  <th>市场</th>
                  <th style={{ textAlign: 'center' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {searchResults.map((item) => (
                  <tr key={`${item.symbol}_${item.market}`}>
                    <td style={{ fontWeight: 700 }}>{item.symbol}</td>
                    <td>{item.name}</td>
                    <td>
                      <span style={{
                        fontSize: 10, padding: '2px 6px', borderRadius: 4,
                        background: item.asset_type === 'stock' ? 'rgba(47,101,217,0.1)' : item.asset_type === 'etf' ? 'rgba(7,143,140,0.1)' : 'rgba(201,154,5,0.1)',
                        color: item.asset_type === 'stock' ? '#2f65d9' : item.asset_type === 'etf' ? '#078f8c' : '#c99a05',
                      }}>
                        {ASSET_TYPE_LABEL[item.asset_type] ?? item.asset_type}
                      </span>
                    </td>
                    <td>{item.market}</td>
                    <td style={{ textAlign: 'center' }}>
                      <button className="text-button" style={{ fontSize: 12 }} onClick={() => handleAddWatchlist(item)}>
                        + 加入自选
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {searchQuery.trim() && !searchLoading && searchResults.length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            未找到匹配的标的
          </div>
        )}
      </Panel>

      {/* Watchlist Panel */}
      <Panel
        title="我的自选"
        subtitle={`已购入 ${holdingItems.length} 只 / 未购入 ${watchingItems.length} 只`}
        actions={
          <button className="icon-button" onClick={fetchWatchlist} disabled={watchlistLoading}>
            {watchlistLoading ? '刷新中...' : '刷新'}
          </button>
        }
      >
        {watchlistLoading && watchlistItems.length === 0 ? (
          <Skeleton height={120} />
        ) : watchlistItems.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
            <div style={{ fontSize: 14, marginBottom: 8 }}>暂无自选标的</div>
            <div style={{ fontSize: 12, lineHeight: 1.6 }}>
              您可以通过以下方式添加：<br/>
              1. 在上方搜索框输入代码（如 300274）或名称，点击「+ 加入自选」<br/>
              2. 在「交易管理」中买入标的，系统会自动加入自选
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 已购入 */}
            {holdingItems.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>已购入 ({holdingItems.length})</div>
                  <WatchlistTable
                    items={holdingItems}
                    selectedItem={selectedItem}
                    onSelect={handleSelect}
                    onRemove={handleRemove}
                    onForceRefresh={handleForceRefresh}
                    onTodayRefresh={handleTodayRefresh}
                  />
                </div>
              )}
              {/* 未购入 */}
              {watchingItems.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>未购入 ({watchingItems.length})</div>
                  <WatchlistTable
                    items={watchingItems}
                    selectedItem={selectedItem}
                    onSelect={handleSelect}
                    onRemove={handleRemove}
                    onForceRefresh={handleForceRefresh}
                    onTodayRefresh={handleTodayRefresh}
                  />
              </div>
            )}
          </div>
        )}
      </Panel>

      {/* ===== Detail Panel (below watchlist) ===== */}
      {selectedItem && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Quote Card */}
          <QuoteCard item={selectedItem} />

          {/* Chart: K-line for stocks, NAV curve for funds */}
          {isFundSelected ? (
            <Panel
              title="业绩走势"
              subtitle={`${selectedItem.name} (${selectedItem.symbol})`}
              actions={
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {(['1m', '3m', '6m', '1y', 'all'] as const).map((r) => (
                    <button
                      key={r}
                      className={`text-button ${fundPerformanceRange === r ? 'selected' : ''}`}
                      onClick={() => handleFundRangeChange(r)}
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
          ) : (
            <Panel
              title="K线图"
              subtitle={`${selectedItem.name} (${selectedItem.symbol})`}
              actions={
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <SegmentedControl options={PERIODS.map((p) => ({ label: p.label, value: p.value }))} selected={period} onChange={handlePeriodChange} />
                </div>
              }
            >
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                {INDICATORS_OPTIONS.map((ind) => (
                  <button key={ind.key} className="text-button" onClick={() => toggleIndicator(ind.key)}
                    style={{ background: activeIndicators.includes(ind.key) ? ind.color : undefined, color: activeIndicators.includes(ind.key) ? '#fff' : undefined }}>
                    {ind.label}
                  </button>
                ))}
              </div>
              {loading && klineData.length === 0 ? (
                <Skeleton height={400} />
              ) : error && klineData.length === 0 ? (
                <div className="alert-item severe" style={{ margin: 16 }}>
                  <b>K线数据加载失败</b>
                  <p>{error}</p>
                  <button className="primary-button" onClick={() => selectedItem && fetchKline(selectedItem.asset_id, period)} style={{ marginTop: 8 }}>重试</button>
                </div>
              ) : klineData.length === 0 ? (
                <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)' }}>
                  <p>暂无K线数据</p>
                  <p style={{ fontSize: 12, marginTop: 4, marginBottom: 12 }}>正在从数据源获取...</p>
                  <button
                    className="primary-button"
                    onClick={async () => {
                      if (!selectedItem) return
                      setMessage('正在刷新K线...')
                      await fetchKline(selectedItem.asset_id, period)
                      setMessage('')
                    }}
                    style={{ fontSize: 13 }}
                  >
                    加载K线数据
                  </button>
                </div>
              ) : (
                <ReactEChartsCore echarts={echarts} option={klineOption} style={{ height: 400, width: '100%' }} notMerge />
              )}
            </Panel>
          )}
        </div>
      )}
    </div>
  )
}

// ── Watchlist Table ──

function WatchlistTable({
  items,
  selectedItem,
  onSelect,
  onRemove,
  onForceRefresh,
  onTodayRefresh,
}: {
  items: WatchlistItemWithStatus[]
  selectedItem: WatchlistItemWithStatus | null
  onSelect: (item: WatchlistItemWithStatus) => void
  onRemove: (assetId: string) => void
  onForceRefresh?: (item: WatchlistItemWithStatus) => void
  onTodayRefresh?: (item: WatchlistItemWithStatus) => void
}) {
  return (
    <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
      <table className="holding-table">
        <thead>
          <tr>
            <th>代码</th>
            <th>名称</th>
            <th>类型</th>
            <th style={{ textAlign: 'right' }}>最新价</th>
            <th style={{ textAlign: 'right' }}>涨跌幅</th>
            <th>质量</th>
            <th style={{ textAlign: 'center' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const price = item.quote?.price
            const changePct = item.quote?.change_pct
            const isFund = item.asset_type === 'fund'
            const isSelected = selectedItem?.asset_id === item.asset_id
            return (
              <tr
                key={item.id}
                onClick={() => onSelect(item)}
                style={{ cursor: 'pointer', background: isSelected ? 'rgba(47,101,217,0.06)' : undefined }}
              >
                <td style={{ fontWeight: 700 }}>{item.symbol}</td>
                <td>{item.name}</td>
                <td>
                  <span style={{
                    fontSize: 10, padding: '2px 6px', borderRadius: 4,
                    background: item.asset_type === 'stock' ? 'rgba(47,101,217,0.1)' : item.asset_type === 'etf' ? 'rgba(7,143,140,0.1)' : 'rgba(201,154,5,0.1)',
                    color: item.asset_type === 'stock' ? '#2f65d9' : item.asset_type === 'etf' ? '#078f8c' : '#c99a05',
                  }}>
                    {ASSET_TYPE_LABEL[item.asset_type] ?? item.asset_type}
                  </span>
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {price != null ? `¥${isFund ? price.toFixed(4) : price.toFixed(2)}` : '—'}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: (changePct ?? 0) >= 0 ? '#d33f3f' : '#119468', fontWeight: 700 }}>
                  {changePct != null ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%` : '—'}
                </td>
                <td>
                  {item.quote_quality ? <DataQualityBadge quality={item.quote_quality} /> : '—'}
                </td>
                <td style={{ textAlign: 'center' }}>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                    <button
                      className="text-button"
                      style={{ fontSize: 11, color: '#2f65d9' }}
                      title="从在线数据源强制获取该标的全部数据"
                      onClick={(e) => { e.stopPropagation(); onForceRefresh?.(item) }}
                    >
                      强制刷新
                    </button>
                    <button
                      className="text-button"
                      style={{ fontSize: 11, color: '#078f8c' }}
                      title="仅刷新该标的今日价格/净值"
                      onClick={(e) => { e.stopPropagation(); onTodayRefresh?.(item) }}
                    >
                      今日刷新
                    </button>
                    <button
                      className="text-button"
                      style={{ fontSize: 11, color: '#d33f3f' }}
                      onClick={(e) => { e.stopPropagation(); onRemove(item.asset_id) }}
                    >
                      移除
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Quote Card ──

function QuoteCard({ item }: { item: WatchlistItemWithStatus }) {
  const quote = item.quote
  const updatedAt = quote?.quote_time
    ? new Date(quote.quote_time).toLocaleString('zh-CN')
    : '—'

  return (
    <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 16, border: '1px solid var(--line)' }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
        <span>实时行情</span>
        <span style={{ fontSize: 11 }}>更新: {updatedAt}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {quote?.price != null ? `¥${item.asset_type === 'fund' ? quote.price.toFixed(4) : quote.price.toFixed(2)}` : '—'}
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, color: (quote?.change_pct ?? 0) >= 0 ? '#d33f3f' : '#119468' }}>
          {quote?.change_pct != null
            ? `${quote.change_pct >= 0 ? '+' : ''}${quote.change_pct.toFixed(2)}%`
            : '—'}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: 13 }}>
        <div><span style={{ color: 'var(--muted)' }}>市场:</span> {item.market}</div>
        <div><span style={{ color: 'var(--muted)' }}>类型:</span> {ASSET_TYPE_LABEL[item.asset_type] ?? item.asset_type}</div>
        <div><span style={{ color: 'var(--muted)' }}>代码:</span> {item.symbol}</div>
        <div><span style={{ color: 'var(--muted)' }}>持仓:</span> {item.has_position ? `${item.quantity} 股` : '无持仓'}</div>
        {quote?.volume != null && (
          <div><span style={{ color: 'var(--muted)' }}>成交量:</span> {(quote.volume / 10000).toFixed(0)}万</div>
        )}
        {quote?.source && (
          <div><span style={{ color: 'var(--muted)' }}>来源:</span> {quote.source}</div>
        )}
      </div>
      {item.quote_quality && (
        <div style={{ marginTop: 10 }}>
          <DataQualityBadge quality={item.quote_quality} />
        </div>
      )}
    </div>
  )
}
