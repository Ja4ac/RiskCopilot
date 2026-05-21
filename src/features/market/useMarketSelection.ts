import { useEffect, useState, useCallback } from 'react'
import { useMarketStore } from '@/stores/market.store'
import { ipcInvoke } from '@/hooks/useIPC'
import { IPC_CHANNELS } from '@/types'
import type {
  KlinePeriod,
  IndicatorType,
  WatchlistItemWithStatus,
  InstrumentListing,
} from '@shared/types/database'

export function useMarketSelection() {
  const {
    fetchKline,
    fetchIndicators,
    setPeriod,
    selectedAssetId,
    setSelectedAssetId,
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
        fetchKline(item.asset_id, useMarketStore.getState().period)
        fetchIndicators(item.asset_id, useMarketStore.getState().period, activeIndicators)
      }
      setSelectedAssetId(null)
    }
  }, [selectedAssetId, watchlistItems, fetchKline, fetchIndicators, activeIndicators, setSelectedAssetId])

  // ── Auto-select first watchlist item if none selected ──
  useEffect(() => {
    if (watchlistItems.length > 0 && !selectedItem && !selectedAssetId) {
      const first = watchlistItems[0]
      setSelectedItem(first)
      if (first.asset_type !== 'fund') {
        fetchKline(first.asset_id, useMarketStore.getState().period)
        fetchIndicators(first.asset_id, useMarketStore.getState().period, activeIndicators)
      }
    }
  }, [watchlistItems, selectedItem, selectedAssetId, fetchKline, fetchIndicators, activeIndicators])

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
        results: { listing: InstrumentListing; quality: import('@shared/types/database').DataQualityStatus }[]
        total: number
        fallbackUsed: boolean
      }>(IPC_CHANNELS.INSTRUMENT_SEARCH, {
        query: query.trim(),
        limit: 20,
      })
      setSearchResults(data?.results?.map((r) => r.listing) ?? [])
    } catch {
      // silently fail — UI stays empty
    } finally {
      setSearchLoading(false)
    }
  }, [])

  // ── Add to watchlist ──
  const handleAddWatchlist = useCallback(async (item: InstrumentListing) => {
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
  }, [fetchWatchlist])

  // ── Remove from watchlist ──
  const handleRemove = useCallback(async (assetId: string) => {
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
  }, [fetchWatchlist, selectedItem])

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
        fetchKline(item.asset_id, useMarketStore.getState().period)
        fetchIndicators(item.asset_id, useMarketStore.getState().period, activeIndicators)
      }
    },
    [fetchKline, fetchIndicators, activeIndicators, fundPerformanceRange]
  )

  // ── Period handler ──
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

  // ── Fund range handler ──
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

  // ── Toggle indicator ──
  const toggleIndicator = useCallback(
    (keyStr: string) => {
      const key = keyStr as IndicatorType
      setActiveIndicators((prev) => {
        const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
        if (selectedItem && next.length > 0) {
          fetchIndicators(selectedItem.asset_id, useMarketStore.getState().period, next)
        }
        return next
      })
    },
    [selectedItem, fetchIndicators]
  )

  // ── Single asset refresh handlers ──
  const handleForceRefresh = useCallback(async (item: WatchlistItemWithStatus) => {
    setMessage(`正在强制刷新 ${item.name}...`)
    try {
      // Clear all cached data for this asset and re-fetch via IPC
      await ipcInvoke(IPC_CHANNELS.MARKET_FORCE_REFRESH_ASSET, {
        assetId: item.asset_id,
        symbol: item.symbol,
        market: item.market,
        assetType: item.asset_type,
      })
      // Refresh display data
      if (!(item.asset_type === 'fund')) {
        await fetchKline(item.asset_id, useMarketStore.getState().period, true)
      }
      setMessage(`${item.name} 强制刷新完成`)
    } catch (e: any) {
      setMessage(`强制刷新 ${item.name} 失败: ${e.message || '未知错误'}`)
    }
    setTimeout(() => setMessage(null), 3000)
  }, [fetchKline])

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
        await fetchKline(item.asset_id, useMarketStore.getState().period)
      }
      setMessage(`${item.name} 今日数据已刷新`)
    } catch (e: any) {
      setMessage(`刷新 ${item.name} 失败: ${e.message || '未知错误'}`)
    }
    setTimeout(() => setMessage(null), 3000)
  }, [fetchKline])

  // ── Derived state ──
  const holdingItems = watchlistItems.filter((i) => i.has_position)
  const watchingItems = watchlistItems.filter((i) => !i.has_position)
  const isFundSelected = selectedItem?.asset_type === 'fund'

  return {
    // search
    searchQuery,
    searchResults,
    searchLoading,
    handleSearch,
    handleAddWatchlist,
    // watchlist
    watchlistItems,
    watchlistLoading,
    fetchWatchlist,
    handleRemove,
    // selection
    selectedItem,
    handleSelect,
    // indicators
    activeIndicators,
    toggleIndicator,
    // period
    handlePeriodChange,
    // fund
    fundPerformance,
    fundPerformanceLoading,
    fundPerformanceRange,
    handleFundRangeChange,
    // refresh
    handleForceRefresh,
    handleTodayRefresh,
    // message
    message,
    // computed
    holdingItems,
    watchingItems,
    isFundSelected,
  }
}
