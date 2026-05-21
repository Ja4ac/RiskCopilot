import { useState, useRef, useCallback, useEffect } from 'react'
import { usePortfolioStore } from '@/stores/portfolio.store'

/**
 * Custom hook that encapsulates portfolio refresh logic and shared UI state.
 * - refreshPortfolio: fetches positions, summary, and trades in parallel
 * - statusMsg: auto-clears after 3 seconds
 * - saving: loading state for save operations
 * - addModalCounter: ref to force remount of add modals
 */
export function usePortfolioRefresh() {
  const { fetchPositions, fetchSummary, fetchTrades } = usePortfolioStore()
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const addModalCounter = useRef(0)

  // Clear status after 3s
  useEffect(() => {
    if (!statusMsg) return
    const t = setTimeout(() => setStatusMsg(null), 3000)
    return () => clearTimeout(t)
  }, [statusMsg])

  const refreshPortfolio = useCallback(async () => {
    await Promise.all([
      fetchPositions(),
      fetchSummary(),
      fetchTrades(),
    ])
  }, [fetchPositions, fetchSummary, fetchTrades])

  return { refreshPortfolio, statusMsg, setStatusMsg, saving, setSaving, addModalCounter }
}
