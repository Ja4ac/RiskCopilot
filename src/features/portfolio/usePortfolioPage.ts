import { useEffect, useState } from 'react'
import { usePortfolioStore } from '@/stores/portfolio.store'
import { ipcInvoke } from '@/hooks/useIPC'
import { IPC_CHANNELS } from '@/types'
import type { IpcAddTradePayload, Trade } from '@/types'
import { usePortfolioRefresh } from '@/features/portfolio/usePortfolioRefresh'
import { type EditingTrade } from '@/features/portfolio/TradeModal'

/**
 * Central hook for the PositionsPage. Encapsulates all state, side-effects,
 * and action handlers so the page component stays lean (~100 lines).
 */
export function usePortfolioPage() {
  const {
    positions, trades, summary, loading, error,
    addTrade, addFundPurchase, updateTrade, voidTrade,
    importCSV, exportCSV,
  } = usePortfolioStore()
  const { refreshPortfolio, statusMsg, setStatusMsg, saving, setSaving, addModalCounter } = usePortfolioRefresh()

  const [showModal, setShowModal] = useState(false)
  const [showFundModal, setShowFundModal] = useState(false)
  const [editingTrade, setEditingTrade] = useState<EditingTrade | null>(null)
  const [editingFundTrade, setEditingFundTrade] = useState<Trade | null>(null)

  // ── Initial load ──
  useEffect(() => {
    refreshPortfolio()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Debug logging ──
  useEffect(() => {
    if (positions.length > 0) {
      console.group('[PositionsPage] Positions Data')
      positions.forEach((p) => {
        console.log(
          `${p.asset?.symbol} (${p.asset?.name}): qty=${p.quantity.toFixed(4)}, avgCost=${p.avg_cost.toFixed(4)}, ` +
          `marketValue=${p.market_value.toFixed(2)}, unrealizedPnl=${p.unrealized_pnl.toFixed(2)}, ` +
          `totalReturnPct=${p.total_return_pct.toFixed(2)}%, quotePrice=${p.quote?.price ?? 'null'}`
        )
      })
      console.groupEnd()
    }
    if (trades.length > 0) {
      console.group('[PositionsPage] Trades Data')
      trades.forEach((t) => {
        console.log(
          `${t.asset?.symbol} (${t.asset?.name}): side=${t.side}, qty=${t.quantity.toFixed(4)}, price=${t.price.toFixed(4)}, ` +
          `time=${t.trade_time}, source=${t.source}`
        )
      })
      console.groupEnd()
    }
  }, [positions, trades])

  // ── Handlers ──

  const handleAddFund = async (payload: { symbol: string; name: string; amount: number; purchase_time: string; side: 'buy' | 'sell' }) => {
    setSaving(true)
    try {
      await addFundPurchase({
        symbol: payload.symbol,
        name: payload.name || payload.symbol,
        amount: payload.amount,
        purchase_time: payload.purchase_time,
        account_id: 'default',
        side: payload.side,
      })
      setShowFundModal(false)
      setEditingFundTrade(null)
      setStatusMsg('基金持仓添加成功')
      refreshPortfolio()
    } catch (e: any) {
      setStatusMsg(`添加基金持仓失败: ${e.message || String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateFund = async (payload: { symbol: string; name: string; amount: number; purchase_time: string; side: 'buy' | 'sell' }) => {
    if (!editingFundTrade) return
    setSaving(true)
    try {
      await voidTrade(editingFundTrade.id)
      await addFundPurchase({
        symbol: payload.symbol,
        name: payload.name || payload.symbol,
        amount: payload.amount,
        purchase_time: payload.purchase_time,
        account_id: 'default',
        side: payload.side,
      })
      setShowFundModal(false)
      setEditingFundTrade(null)
      setStatusMsg('基金持仓修改成功')
      refreshPortfolio()
    } catch (e: any) {
      setStatusMsg(`修改基金持仓失败: ${e.message || String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  const handleImport = async () => {
    try {
      const filePath = await ipcInvoke<string>(IPC_CHANNELS.APP_OPEN_FILE)
      if (!filePath) return

      setStatusMsg('正在预览导入...')
      const preview = await ipcInvoke<{
        headers: string[]
        detected_mapping: Record<string, string>
        total_rows: number
        valid_rows: number
        error_rows: number
      }>(IPC_CHANNELS.PORTFOLIO_IMPORT_PREVIEW, { filePath, accountId: 'default' })

      if (preview.error_rows > 0 && preview.valid_rows === 0) {
        setStatusMsg(`导入预览失败: 全部 ${preview.total_rows} 行有错误`)
        return
      }

      const commitResult = await ipcInvoke<{
        job_id: string
        imported: number
        skipped: number
        errors: { row_index: number; errors: string[] }[]
        positions_updated: number
      }>(IPC_CHANNELS.PORTFOLIO_IMPORT_FILE, {
        filePath,
        accountId: 'default',
        fieldMapping: preview.detected_mapping,
      })

      setStatusMsg(
        `导入成功: ${commitResult.imported} 笔交易, ${commitResult.positions_updated} 个持仓已更新` +
        (commitResult.skipped > 0 ? ` (${commitResult.skipped} 行跳过)` : '')
      )
      refreshPortfolio()
    } catch (e: any) {
      setStatusMsg(`导入失败: ${e.message || String(e)}`)
    }
  }

  const handleExport = async () => {
    try {
      await exportCSV('positions')
      setStatusMsg('导出成功')
    } catch (e: any) {
      setStatusMsg(`导出失败: ${e.message || String(e)}`)
    }
  }

  const handleAddTrade = async (payload: IpcAddTradePayload) => {
    setSaving(true)
    try {
      await addTrade(payload)
      setShowModal(false)
      setEditingTrade(null)
      setStatusMsg('交易添加成功')
      refreshPortfolio()
    } catch (e: any) {
      setStatusMsg(`添加失败: ${e.message || String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateTrade = async (payload: IpcAddTradePayload) => {
    if (!editingTrade) return
    setSaving(true)
    try {
      await updateTrade(editingTrade.id, {
        side: payload.side,
        quantity: payload.quantity,
        price: payload.price,
        fee: payload.fee,
        tax: payload.tax,
        trade_time: payload.trade_time,
      })
      setShowModal(false)
      setEditingTrade(null)
      setStatusMsg('交易更新成功')
      refreshPortfolio()
    } catch (e: any) {
      setStatusMsg(`更新失败: ${e.message || String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  const handleEditTrade = (t: Trade) => {
    if (t.source === 'fund_purchase') {
      setEditingTrade(null)
      setShowModal(false)
      setEditingFundTrade(t)
      setShowFundModal(true)
    } else {
      setEditingFundTrade(null)
      setShowFundModal(false)
      setEditingTrade({
        ...t,
        symbol: t.asset?.symbol,
        market: t.asset?.market,
        asset_name: t.asset?.name,
        asset_type: t.asset?.asset_type,
      })
      setShowModal(true)
    }
  }

  const handleVoidTrade = async (t: Trade) => {
    await voidTrade(t.id)
    setStatusMsg('交易已作废')
    refreshPortfolio()
  }

  const handleForceRefresh = async () => {
    setStatusMsg('正在强制刷新（逐支获取，请耐心等待）...')
    try {
      const result = await ipcInvoke<{
        stockCount: number; fundCount: number; quotesWritten: number; klinesWritten: number; positionsUpdated: number
        errors: string[]
      }>(IPC_CHANNELS.MARKET_SYNC_QUOTES)
      await refreshPortfolio()
      const ok = `强制刷新完成: ${result.stockCount}支股票 ${result.fundCount}支基金 | ${result.quotesWritten}条报价 ${result.klinesWritten}根K线 | ${result.positionsUpdated}个持仓更新`
      const errs = result.errors?.length ? ` | ${result.errors.length}个错误: ${result.errors.slice(0, 3).join('; ')}` : ''
      setStatusMsg(ok + errs)
    } catch (e: any) {
      setStatusMsg(`强制刷新失败: ${e.message || String(e)}`)
    }
  }

  const openAddFund = () => {
    setEditingTrade(null)
    setEditingFundTrade(null)
    setShowModal(false)
    addModalCounter.current++
    setShowFundModal(true)
  }

  const openAddTrade = () => {
    setEditingTrade(null)
    setEditingFundTrade(null)
    addModalCounter.current++
    setShowModal(true)
    setShowFundModal(false)
  }

  const closeTradeModal = () => {
    setShowModal(false)
    setEditingTrade(null)
  }

  const closeFundModal = () => {
    setShowFundModal(false)
    setEditingFundTrade(null)
  }

  return {
    // Data
    positions, trades, summary, loading, error,
    // UI state
    statusMsg, showModal, showFundModal, editingTrade, editingFundTrade, saving, addModalCounter,
    // Handlers
    refreshPortfolio,
    handleAddTrade, handleAddFund, handleUpdateTrade, handleUpdateFund,
    handleImport, handleExport, handleEditTrade, handleVoidTrade, handleForceRefresh,
    // Modal openers
    openAddFund, openAddTrade, closeTradeModal, closeFundModal,
  }
}
