import React, { useCallback } from 'react'
import * as echarts from 'echarts/core'
import { CandlestickChart, BarChart, LineChart } from 'echarts/charts'
import {
  GridComponent, TooltipComponent, DataZoomComponent, MarkLineComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { useMarketStore } from '@/stores/market.store'
import { useMarketSelection } from '@/features/market/useMarketSelection'
import { InstrumentSearch } from '@/features/market/InstrumentSearch'
import { WatchlistPanel } from '@/features/market/WatchlistPanel'
import { KlinePanel } from '@/features/market/KlinePanel'
import { QuoteCard } from '@/features/market/QuoteCard'
import type { KlinePeriod } from '@shared/types/database'

// ── ECharts setup ──

echarts.use([
  CandlestickChart, BarChart, LineChart,
  GridComponent, TooltipComponent, DataZoomComponent, MarkLineComponent,
  CanvasRenderer,
])

// ── Constants ──

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

// ── Main Component ──

export function MarketPage() {
  const {
    klineData,
    period,
    loading,
    error,
    klineErrorMessage,
    klineErrorCode,
    klineSource,
    klineCacheHit,
    fetchKline,
  } = useMarketStore()

  const {
    searchQuery,
    searchResults,
    searchLoading,
    handleSearch,
    handleAddWatchlist,
    watchlistLoading,
    fetchWatchlist,
    handleRemove,
    selectedItem,
    handleSelect,
    activeIndicators,
    toggleIndicator,
    handlePeriodChange,
    fundPerformance,
    fundPerformanceLoading,
    fundPerformanceRange,
    handleFundRangeChange,
    handleForceRefresh,
    handleTodayRefresh,
    message,
    holdingItems,
    watchingItems,
  } = useMarketSelection()

  const onFetchKline = useCallback(
    (assetId: string, p: KlinePeriod, force?: boolean) => fetchKline(assetId, p, force),
    [fetchKline]
  )

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
      <InstrumentSearch
        searchQuery={searchQuery}
        searchResults={searchResults}
        searchLoading={searchLoading}
        onSearch={handleSearch}
        onAddWatchlist={handleAddWatchlist}
        assetTypeLabel={ASSET_TYPE_LABEL}
      />

      {/* Watchlist Panel */}
      <WatchlistPanel
        holdingItems={holdingItems}
        watchingItems={watchingItems}
        selectedItem={selectedItem}
        watchlistLoading={watchlistLoading}
        onSelect={handleSelect}
        onRemove={handleRemove}
        onForceRefresh={handleForceRefresh}
        onTodayRefresh={handleTodayRefresh}
        onRefresh={fetchWatchlist}
      />

      {/* Detail: Quote + Chart */}
      {selectedItem && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <QuoteCard item={selectedItem} />
          <KlinePanel
            selectedItem={selectedItem}
            klineData={klineData}
            period={period}
            loading={loading}
            error={error}
            klineErrorMessage={klineErrorMessage}
            klineErrorCode={klineErrorCode}
            klineSource={klineSource}
            klineCacheHit={klineCacheHit}
            activeIndicators={activeIndicators}
            fundPerformance={fundPerformance}
            fundPerformanceLoading={fundPerformanceLoading}
            fundPerformanceRange={fundPerformanceRange}
            onPeriodChange={handlePeriodChange}
            onIndicatorToggle={toggleIndicator}
            onFundRangeChange={handleFundRangeChange}
            onFetchKline={onFetchKline}
          />
        </div>
      )}
    </div>
  )
}
