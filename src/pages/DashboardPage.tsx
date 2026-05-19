import { useEffect, useCallback, useState } from 'react'
import { usePortfolioStore } from '../stores/portfolio.store'
import { useRiskStore } from '../stores/risk.store'
import { useAlertStore } from '../stores/alert.store'
import { useAppStore } from '../stores/app.store'
import { useMarketStore } from '../stores/market.store'
import { KPIGrid } from '../components/dashboard/KPIGrid'
import { HoldingsPanel } from '../components/dashboard/HoldingsPanel'
import { AlertSummaryPanel } from '../components/dashboard/AlertSummaryPanel'
import { PortfolioChart } from '../components/dashboard/PortfolioChart'

export function DashboardPage() {
  const { fetchPositions, positions, fetchSummary } = usePortfolioStore()
  const fetchRiskSummary = useRiskStore((s) => s.fetchSummary)
  const fetchAlerts = useAlertStore((s) => s.fetchAlerts)
  const fetchDataSourceStatus = useAppStore((s) => s.fetchDataSourceStatus)
  const setActivePage = useAppStore((s) => s.setActivePage)
  const setSelectedAssetId = useMarketStore((s) => s.setSelectedAssetId)

  const [chartMode, setChartMode] = useState<'1M' | '6M' | '1Y' | 'ALL'>('1Y')
  // Increment to force PortfolioChart re-fetch when positions change
  const [chartRefreshKey, setChartRefreshKey] = useState(0)

  useEffect(() => {
    fetchPositions()
    fetchSummary()
    fetchRiskSummary()
    fetchAlerts()
    fetchDataSourceStatus()
  }, [fetchPositions, fetchSummary, fetchRiskSummary, fetchAlerts, fetchDataSourceStatus])

  // Re-fetch chart data when positions list changes
  useEffect(() => {
    setChartRefreshKey((k) => k + 1)
  }, [positions.length])

  const handleSelectAsset = useCallback((assetId: string) => {
    setSelectedAssetId(assetId)
    setActivePage('market')
  }, [setSelectedAssetId, setActivePage])

  return (
    <>
      <KPIGrid />
      <PortfolioChart key={chartRefreshKey} mode={chartMode} onModeChange={setChartMode} />
      <AlertSummaryPanel />
      <HoldingsPanel onSelect={handleSelectAsset} />
    </>
  )
}
