import React, { useEffect, useMemo, useState, useRef } from 'react'
import { usePortfolioStore } from '@/stores/portfolio.store'
import { ipcInvoke } from '@/hooks/useIPC'
import { IPC_CHANNELS } from '@/types'
import { Panel } from '@/components/ui/Panel'
import { Skeleton } from '@/components/ui/Skeleton'
import { DialogModal } from '@/components/ui/DialogModal'
import type { IpcAddTradePayload, Trade } from '@/types'

interface EditingTrade extends Trade {
  symbol?: string
  market?: string
  asset_name?: string
  asset_type?: string
}

// Helper: convert UTC ISO string to local datetime-local format (YYYY-MM-DDTHH:MM)
function toDatetimeLocalValue(isoString: string | undefined): string {
  if (!isoString) return new Date().toISOString().slice(0, 16)
  try {
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 16)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day}T${hours}:${minutes}`
  } catch {
    return new Date().toISOString().slice(0, 16)
  }
}

// Helper: convert local datetime-local value to UTC ISO string
function fromDatetimeLocalValue(localValue: string): string {
  try {
    const d = new Date(localValue)
    if (isNaN(d.getTime())) return new Date().toISOString()
    return d.toISOString()
  } catch {
    return new Date().toISOString()
  }
}

// ─── Add / Edit Trade Modal ───────────────────────────────────────────
function TradeModal({
  visible,
  onClose,
  onSave,
  saving,
  trade,
  mode,
}: {
  visible: boolean
  onClose: () => void
  onSave: (payload: IpcAddTradePayload) => void
  saving: boolean
  trade?: EditingTrade | null
  mode: 'add' | 'edit'
}) {
  const isEdit = mode === 'edit'
  const firstInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (visible) setTimeout(() => firstInputRef.current?.focus(), 50) }, [visible])

  const [form, setForm] = useState({
    symbol: '',
    market: 'SZ',
    asset_name: '',
    asset_type: 'stock' as 'stock' | 'etf' | 'fund',
    account_id: 'default',
    side: 'buy' as 'buy' | 'sell',
    quantity: 100,
    price: 10,
    fee: 0,
    tax: 0,
    auto_calc_fee: false,
    trade_time: new Date().toISOString().slice(0, 16),
  })

  // Pre-fill form when editing or when modal opens/closes
  useEffect(() => {
    if (!visible) return
    if (mode === 'edit' && trade) {
      const timeStr = toDatetimeLocalValue(trade.trade_time)
      const isFund = trade.asset_type === 'fund' || trade.market === 'OF'
      setForm({
        symbol: trade.symbol || '',
        market: isFund ? 'OTC' : (trade.market || 'SZ'),
        asset_name: trade.asset_name || '',
        asset_type: isFund ? 'stock' as const : ((trade.asset_type as 'stock' | 'etf' | 'fund') || 'stock'),
        account_id: trade.account_id || 'default',
        side: trade.side || 'buy',
        quantity: trade.quantity || 0,
        price: trade.price || 0,
        fee: trade.fee || 0,
        tax: trade.tax || 0,
        auto_calc_fee: false,
        trade_time: timeStr,
      })
    } else {
      // Reset to defaults when opening for add
      setForm({
        symbol: '',
        market: 'SZ',
        asset_name: '',
        asset_type: 'stock',
        account_id: 'default',
        side: 'buy',
        quantity: 100,
        price: 10,
        fee: 0,
        tax: 0,
        auto_calc_fee: false,
        trade_time: new Date().toISOString().slice(0, 16),
      })
    }
  }, [visible])  // Only depend on visible — always reset on open

  // Auto-recalculate fees when quantity/price/side changes
  useEffect(() => {
    if (!form.auto_calc_fee) return
    const amount = form.quantity * form.price
    const newFee = Math.max(5, Math.round(amount * 0.00025 * 100) / 100)
    const newTax = form.side === 'sell' ? Math.round(amount * 0.001 * 100) / 100 : 0
    setForm((prev) => ({ ...prev, fee: newFee, tax: newTax }))
  }, [form.quantity, form.price, form.side, form.auto_calc_fee])

  if (!visible) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({
      symbol: form.symbol,
      market: form.market,
      asset_name: form.asset_name || form.symbol,
      asset_type: form.asset_type,
      account_id: form.account_id,
      side: form.side,
      quantity: form.quantity,
      price: form.price,
      fee: form.fee,
      tax: form.tax,
      trade_time: fromDatetimeLocalValue(form.trade_time),
      source: 'manual',
    })
  }

  return (
    <DialogModal open={visible} onClose={onClose}>
      <div className="panel" style={{ border: 'none', borderRadius: 12, boxShadow: 'none' }}>
        <div className="panel-header">
          <div>
            <h2>{isEdit ? '编辑交易' : '添加交易'}</h2>
            <p>{isEdit ? '修改交易记录' : '录入一笔新的交易记录'}</p>
          </div>
          <button className="icon-button" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gap: 12, padding: '0 20px 20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 10 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>
                  证券代码 {isEdit && <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(不可修改)</span>}
                </label>
                <input
                  ref={firstInputRef}
                  required
                  value={form.symbol}
                  disabled={isEdit}
                  onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                  style={{
                    width: '100%', height: 36, border: '1px solid var(--line)',
                    borderRadius: 8, padding: '0 10px', fontSize: 13,
                    background: isEdit ? 'var(--surface)' : undefined,
                    color: isEdit ? 'var(--muted)' : undefined,
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>
                  市场 {isEdit && <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(不可修改)</span>}
                </label>
                <select
                  value={form.market}
                  disabled={isEdit}
                  onChange={(e) => setForm({ ...form, market: e.target.value })}
                  style={{
                    width: '100%', height: 36, border: '1px solid var(--line)',
                    borderRadius: 8, padding: '0 8px', fontSize: 13,
                    background: isEdit ? 'var(--surface)' : undefined,
                    color: isEdit ? 'var(--muted)' : undefined,
                  }}
                >
                  <option value="SZ">深圳</option>
                  <option value="SH">上海</option>
                  <option value="HK">港股</option>
                  <option value="US">美股</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>
                  名称 <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(选填)</span>
                </label>
                <input
                  placeholder="如: 宁德时代"
                  value={form.asset_name}
                  onChange={(e) => setForm({ ...form, asset_name: e.target.value })}
                  style={{
                    width: '100%', height: 36, border: '1px solid var(--line)',
                    borderRadius: 8, padding: '0 10px', fontSize: 13,
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>
                  资产类型 {isEdit && <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(不可修改)</span>}
                </label>
                <select
                  value={form.asset_type}
                  disabled={isEdit}
                  onChange={(e) => setForm({ ...form, asset_type: e.target.value as 'stock' | 'etf' })}
                  style={{
                    width: '100%', height: 36, border: '1px solid var(--line)',
                    borderRadius: 8, padding: '0 8px', fontSize: 13,
                    background: isEdit ? 'var(--surface)' : undefined,
                    color: isEdit ? 'var(--muted)' : undefined,
                  }}
                >
                  <option value="stock">股票</option>
                  <option value="etf">ETF</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>方向</label>
                <select
                  value={form.side}
                  onChange={(e) => setForm({ ...form, side: e.target.value as 'buy' | 'sell' })}
                  style={{
                    width: '100%', height: 36, border: '1px solid var(--line)',
                    borderRadius: 8, padding: '0 10px', fontSize: 13,
                  }}
                >
                  <option value="buy">买入</option>
                  <option value="sell">卖出</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>
                  数量
                  <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}>
                    {' '}(股票为100股整数倍)
                  </span>
                </label>
                <input
                  type="number"
                  required
                  step={form.asset_type === 'stock' ? 100 : 1}
                  min={form.asset_type === 'stock' ? 100 : 1}
                  value={form.quantity}
                  onChange={(e) => {
                    const val = Number(e.target.value)
                    // Enforce lot size for stocks: round to nearest 100
                    const adjusted = form.asset_type === 'stock' ? Math.round(val / 100) * 100 : val
                    setForm({ ...form, quantity: Math.max(adjusted, form.asset_type === 'stock' ? 100 : 1) })
                  }}
                  style={{
                    width: '100%', height: 36, border: '1px solid var(--line)',
                    borderRadius: 8, padding: '0 10px', fontSize: 13,
                  }}
                />
              </div>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>价格</label>
              <input
                type="number"
                required
                step="0.01"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
                style={{
                  width: '100%', height: 36, border: '1px solid var(--line)',
                  borderRadius: 8, padding: '0 10px', fontSize: 13,
                }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <input
                type="checkbox"
                id="auto-calc-fee"
                checked={form.auto_calc_fee}
                onChange={(e) => {
                  const checked = e.target.checked
                  const amount = form.quantity * form.price
                  let newFee = form.fee
                  let newTax = form.tax
                  if (checked) {
                    // Auto-calculate A股 fees
                    // Commission: 0.025%, min 5元
                    newFee = Math.max(5, Math.round(amount * 0.00025 * 100) / 100)
                    // Stamp duty: 0.1% on sell only
                    newTax = form.side === 'sell' ? Math.round(amount * 0.001 * 100) / 100 : 0
                  }
                  setForm({ ...form, auto_calc_fee: checked, fee: newFee, tax: newTax })
                }}
                style={{ width: 16, height: 16 }}
              />
              <label htmlFor="auto-calc-fee" style={{ fontSize: 13, cursor: 'pointer' }}>
                自动计算手续费
                <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}>
                  {' '}(A股: 佣金0.025%最低5元，卖出印花税0.1%)
                </span>
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>
                  手续费
                  <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}>
                    {' '}(佣金/申购费)
                  </span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={form.fee}
                  disabled={form.auto_calc_fee}
                  onChange={(e) => setForm({ ...form, fee: Number(e.target.value) })}
                  style={{
                    width: '100%', height: 36, border: '1px solid var(--line)',
                    borderRadius: 8, padding: '0 10px', fontSize: 13,
                    background: form.auto_calc_fee ? 'var(--surface)' : undefined,
                    color: form.auto_calc_fee ? 'var(--muted)' : undefined,
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>
                  印花税
                  <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}>
                    {' '}(仅A股卖出)
                  </span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={form.tax}
                  disabled={form.auto_calc_fee}
                  onChange={(e) => setForm({ ...form, tax: Number(e.target.value) })}
                  style={{
                    width: '100%', height: 36, border: '1px solid var(--line)',
                    borderRadius: 8, padding: '0 10px', fontSize: 13,
                    background: form.auto_calc_fee ? 'var(--surface)' : undefined,
                    color: form.auto_calc_fee ? 'var(--muted)' : undefined,
                  }}
                />
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
              {form.asset_type === 'stock' && form.side === 'buy' && (
                <span>A股买入仅收佣金（约成交金额的0.025%，最低5元）。</span>
              )}
              {form.asset_type === 'stock' && form.side === 'sell' && (
                <span>A股卖出收佣金+印花税（成交金额的0.1%）。</span>
              )}
              {form.asset_type === 'etf' && (
                <span>ETF交易仅收佣金，无印花税。</span>
              )}
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>交易时间</label>
              <input
                type="datetime-local"
                required
                value={form.trade_time}
                onChange={(e) => setForm({ ...form, trade_time: e.target.value })}
                style={{
                  width: '100%', height: 36, border: '1px solid var(--line)',
                  borderRadius: 8, padding: '0 10px', fontSize: 13,
                }}
              />
            </div>
            <button className="primary-button" type="submit" disabled={saving} style={{ width: '100%' }}>
              {saving ? '保存中...' : isEdit ? '保存修改' : '确认添加'}
            </button>
          </div>
        </form>
      </div>
    </DialogModal>
  )
}

// ─── Main Page ─────────────────────────────────────────────────
export function PositionsPage() {
  const {
    positions, trades, summary, loading, error,
    fetchPositions, fetchSummary, fetchTrades, addTrade, addFundPurchase, updateTrade, voidTrade,
    importCSV, exportCSV,
  } = usePortfolioStore()
  const [showModal, setShowModal] = useState(false)
  const [showFundModal, setShowFundModal] = useState(false)
  interface EditingTrade extends Trade {
    symbol?: string
    market?: string
    asset_name?: string
    asset_type?: string
  }
  const [editingTrade, setEditingTrade] = useState<EditingTrade | null>(null)
  const [editingFundTrade, setEditingFundTrade] = useState<Trade | null>(null)
  const [saving, setSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  // Counter to force fresh remount of add modals
  const addModalCounter = useRef(0)

  // Filters
  const [timeFilter, setTimeFilter] = useState('all')
  const [assetFilter, setAssetFilter] = useState('')
  const [sideFilter, setSideFilter] = useState('all')

  const filteredTrades = trades
    .filter((t) => t.status === 'active')
    .filter((t) => {
      if (timeFilter === 'all') return true
      const days = { '7d': 7, '30d': 30, '90d': 90 }[timeFilter] ?? 0
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - days)
      try {
        const tradeDate = new Date(t.trade_time)
        if (isNaN(tradeDate.getTime())) return true // include trades with invalid dates
        return tradeDate >= cutoff
      } catch {
        return true
      }
    })
    .filter((t) => {
      if (!assetFilter.trim()) return true
      const assetName = positions.find((p) => p.asset_id === t.asset_id)?.asset?.name ?? ''
      const assetSymbol = positions.find((p) => p.asset_id === t.asset_id)?.asset?.symbol ?? ''
      const q = assetFilter.trim().toLowerCase()
      return assetName.toLowerCase().includes(q) || assetSymbol.toLowerCase().includes(q) || t.asset_id.toLowerCase().includes(q)
    })
    .filter((t) => {
      if (sideFilter === 'all') return true
      return t.side === sideFilter
    })
    .sort((a, b) => b.trade_time.localeCompare(a.trade_time))

  useEffect(() => {
    fetchPositions()
    fetchSummary()
    fetchTrades()
  }, [])

  // Clear status after 3s
  useEffect(() => {
    if (!statusMsg) return
    const t = setTimeout(() => setStatusMsg(null), 3000)
    return () => clearTimeout(t)
  }, [statusMsg])

  // Debug logging: log positions and trades to browser console for diagnosis
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
      fetchPositions()
      fetchSummary()
      fetchTrades()
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
      // Void the old fund trade, then re-add with new params
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
      fetchPositions()
      fetchSummary()
      fetchTrades()
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
      fetchPositions()
      fetchSummary()
      fetchTrades()
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
      fetchPositions()
      fetchSummary()
      fetchTrades()
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
      fetchPositions()
      fetchSummary()
      fetchTrades()
    } catch (e: any) {
      setStatusMsg(`更新失败: ${e.message || String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading && trades.length === 0) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ display: 'grid', gap: 14 }}>
          <Skeleton height={48} />
          <Skeleton height={40} />
          <Skeleton height={300} />
        </div>
      </div>
    )
  }

  if (error && trades.length === 0) {
    return (
      <div className="alert-item severe" style={{ margin: 24 }}>
        <b>交易数据加载失败</b>
        <p>{error}</p>
        <button
          className="primary-button"
          onClick={() => { fetchPositions(); fetchSummary(); fetchTrades() }}
          style={{ marginTop: 12 }}
        >
          重试
        </button>
      </div>
    )
  }

  return (
    <div>
      {statusMsg && (
        <div
          className={`alert-item ${statusMsg.includes('失败') ? 'severe' : ''}`}
          style={{ marginBottom: 14 }}
        >
          <b>{statusMsg}</b>
        </div>
      )}

      {/* Filters + Actions */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        {trades.length > 0 && (
          <>
            <select
              value={timeFilter}
              onChange={(e) => setTimeFilter(e.target.value)}
              style={{ height: 32, border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', fontSize: 13, background: 'var(--surface)' }}
            >
              <option value="all">全部时间</option>
              <option value="7d">最近7天</option>
              <option value="30d">最近30天</option>
              <option value="90d">最近90天</option>
            </select>
            <input
              type="text"
              placeholder="筛选标的..."
              value={assetFilter}
              onChange={(e) => setAssetFilter(e.target.value)}
              style={{ height: 32, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', fontSize: 13, background: 'var(--surface)', width: 140 }}
            />
            <select
              value={sideFilter}
              onChange={(e) => setSideFilter(e.target.value)}
              style={{ height: 32, border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', fontSize: 13, background: 'var(--surface)' }}
            >
              <option value="all">全部方向</option>
              <option value="buy">买入</option>
              <option value="sell">卖出</option>
            </select>
          </>
        )}
        <div style={{ flex: 1 }} />
        <button
          className="icon-button"
          title="在线获取全部数据（逐支请求，股票间隔5s，基金间隔10s，防止被屏蔽）"
          onClick={async () => {
            setStatusMsg('正在强制刷新（逐支获取，请耐心等待）...')
            try {
              const result = await ipcInvoke<{
                stockCount: number; fundCount: number; quotesWritten: number; klinesWritten: number; positionsUpdated: number
                errors: string[]
              }>(IPC_CHANNELS.MARKET_SYNC_QUOTES)
              await fetchPositions()
              await fetchSummary()
              const ok = `强制刷新完成: ${result.stockCount}支股票 ${result.fundCount}支基金 | ${result.quotesWritten}条报价 ${result.klinesWritten}根K线 | ${result.positionsUpdated}个持仓更新`
              const errs = result.errors?.length ? ` | ${result.errors.length}个错误: ${result.errors.slice(0, 3).join('; ')}` : ''
              setStatusMsg(ok + errs)
            } catch (e: any) {
              setStatusMsg(`强制刷新失败: ${e.message || String(e)}`)
            }
          }}
        >
          强制刷新
        </button>
        <button className="icon-button" title="仅从本地数据库刷新" onClick={() => { fetchPositions(); fetchSummary(); fetchTrades() }}>
          刷新
        </button>
        <button className="primary-button" onClick={() => { setEditingTrade(null); setEditingFundTrade(null); setShowModal(false); addModalCounter.current++; setShowFundModal(true) }}>
          添加基金
        </button>
        <button className="primary-button" onClick={() => { setEditingTrade(null); setEditingFundTrade(null); addModalCounter.current++; setShowModal(true); setShowFundModal(false) }}>
          添加交易
        </button>
      </div>

      <Panel
        title="交易管理"
        subtitle={
          summary
            ? `总市值 ¥${summary.total_market_value.toLocaleString('zh-CN', { minimumFractionDigits: 0 })}  |  共 ${filteredTrades.length} 笔交易`
            : '加载中...'
        }
      >
        {trades.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)' }}>
            <p style={{ fontSize: 16, marginBottom: 8 }}>暂无交易记录</p>
            <p style={{ fontSize: 13 }}>
              点击右上角「添加交易」手动录入，或通过导入功能批量添加
            </p>
          </div>
        ) : (
          <>
          <table className="holding-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>标的</th>
                <th>方向</th>
                <th style={{ textAlign: 'right' }}>数量</th>
                <th style={{ textAlign: 'right' }}>价格</th>
                <th style={{ textAlign: 'right' }}>金额</th>
                <th style={{ textAlign: 'right' }}>手续费</th>
                <th>状态</th>
                <th style={{ textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredTrades.map((t) => {
                  const assetName = t.asset?.name
                  const assetSymbol = t.asset?.symbol
                  return (
                  <tr key={t.id}>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {(() => {
                        try {
                          const d = new Date(t.trade_time)
                          if (isNaN(d.getTime())) return t.trade_time || '时间无效'
                          return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                        } catch {
                          return t.trade_time || '时间无效'
                        }
                      })()}
                    </td>
                    <td>
                      <strong style={{ fontSize: 13 }}>{assetName || assetSymbol || t.asset_id.slice(0, 8)}</strong>
                      {assetSymbol && (
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{assetSymbol}</div>
                      )}
                    </td>
                    <td>
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 4,
                        background: t.side === 'buy' ? 'rgba(211,63,63,0.1)' : 'rgba(17,148,104,0.1)',
                        color: t.side === 'buy' ? '#d33f3f' : '#119468',
                        fontWeight: 700,
                      }}>
                        {t.side === 'buy' ? '买入' : '卖出'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {t.quantity.toLocaleString('zh-CN')}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      ¥{t.source === 'fund_purchase' ? t.price.toFixed(4) : t.price.toFixed(2)}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                      ¥{(t.quantity * t.price).toFixed(2)}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--muted)', fontSize: 12 }}>
                      ¥{(t.fee + t.tax).toFixed(2)}
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: 'var(--green)' }}>生效</span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                        <button
                          className="text-button"
                          style={{ fontSize: 12 }}
                          onClick={() => {
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
                          }}
                        >
                          编辑
                        </button>
                        <button
                          className="text-button"
                          style={{ fontSize: 12, color: 'var(--red)' }}
                          onClick={() => {
                            const displayPrice = t.source === 'fund_purchase' ? t.price.toFixed(4) : t.price.toFixed(2)
                            if (window.confirm(`确认作废这笔交易？\n${assetName || assetSymbol || t.asset_id.slice(0, 8)} ${t.side === 'buy' ? '买入' : '卖出'} ${t.quantity.toFixed(4)} 份 @ ¥${displayPrice}`)) {
                              voidTrade(t.id)
                              setStatusMsg('交易已作废')
                              fetchPositions()
                              fetchSummary()
                              fetchTrades()
                            }
                          }}
                        >
                          作废
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              )}
            </tbody>
          </table>
          </>
        )}
      </Panel>

      <TradeModal
        key={editingTrade ? editingTrade.id : `new-trade-${addModalCounter.current}`}
        visible={showModal}
        onClose={() => { setShowModal(false); setEditingTrade(null) }}
        onSave={editingTrade ? handleUpdateTrade : handleAddTrade}
        saving={saving}
        trade={editingTrade}
        mode={editingTrade ? 'edit' : 'add'}
      />

      <FundPurchaseModal
        key={editingFundTrade ? editingFundTrade.id : `new-fund-${addModalCounter.current}`}
        visible={showFundModal}
        onClose={() => { setShowFundModal(false); setEditingFundTrade(null) }}
        onSave={editingFundTrade ? handleUpdateFund : handleAddFund}
        saving={saving}
        editingTrade={editingFundTrade ? {
          symbol: editingFundTrade.asset?.symbol,
          name: editingFundTrade.asset?.name,
          amount: Math.round(editingFundTrade.quantity * editingFundTrade.price * 100) / 100,
          trade_time: editingFundTrade.trade_time,
          side: editingFundTrade.side,
        } : null}
        mode={editingFundTrade ? 'edit' : 'add'}
      />
    </div>
  )
}

// ─── Fund Purchase Modal ───────────────────────────────────────────
function FundPurchaseModal({
  visible,
  onClose,
  onSave,
  saving,
  editingTrade,
  mode,
}: {
  visible: boolean
  onClose: () => void
  onSave: (payload: { symbol: string; name: string; amount: number; purchase_time: string; side: 'buy' | 'sell' }) => void
  saving: boolean
  editingTrade?: {
    symbol?: string
    name?: string
    amount?: number
    trade_time?: string
    side?: 'buy' | 'sell'
  } | null
  mode: 'add' | 'edit'
}) {
  const isEdit = mode === 'edit'
  const fundFirstInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (visible) setTimeout(() => fundFirstInputRef.current?.focus(), 50) }, [visible])

  const [form, setForm] = useState({
    symbol: '',
    name: '',
    amount: 10000,
    side: 'buy' as 'buy' | 'sell',
    purchase_time: new Date().toISOString().slice(0, 16),
  })

  // Pre-fill form when editing or when modal opens/closes
  useEffect(() => {
    if (!visible) return
    if (mode === 'edit' && editingTrade) {
      const timeStr = toDatetimeLocalValue(editingTrade.trade_time)
      setForm({
        symbol: editingTrade.symbol || '',
        name: editingTrade.name || '',
        amount: editingTrade.amount || 10000,
        side: editingTrade.side || 'buy',
        purchase_time: timeStr,
      })
    } else {
      // Reset to defaults when opening for add
      setForm({
        symbol: '',
        name: '',
        amount: 10000,
        side: 'buy',
        purchase_time: new Date().toISOString().slice(0, 16),
      })
    }
  }, [visible])  // Only depend on visible — always reset on open

  if (!visible) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({
      symbol: form.symbol,
      name: form.name,
      amount: form.amount,
      purchase_time: new Date(form.purchase_time).toISOString(),
      side: form.side,
    })
  }

  return (
    <DialogModal open={visible} onClose={onClose}>
      <div className="panel" style={{ border: 'none', borderRadius: 12, boxShadow: 'none' }}>
        <div className="panel-header">
          <div>
            <h2>{isEdit ? '编辑基金持仓' : '添加基金持仓'}</h2>
            <p>{isEdit ? '修改金额或时间，系统将重新计算份额和净值' : '输入基金代码、买入时间和金额，系统自动查询净值并计算份额'}</p>
          </div>
          <button className="icon-button" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gap: 12, padding: '0 20px 20px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>
                基金代码 {isEdit && <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(不可修改)</span>}
              </label>
              <input
                ref={fundFirstInputRef}
                required
                placeholder="025209"
                value={form.symbol}
                disabled={isEdit}
                onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                style={{
                  width: '100%', height: 36, border: '1px solid var(--line)',
                  borderRadius: 8, padding: '0 10px', fontSize: 13,
                  background: isEdit ? 'var(--surface)' : undefined,
                  color: isEdit ? 'var(--muted)' : undefined,
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>
                基金名称 <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(选填)</span>
              </label>
              <input
                placeholder="如: 永赢先锋半导体智选混合C"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                style={{
                  width: '100%', height: 36, border: '1px solid var(--line)',
                  borderRadius: 8, padding: '0 10px', fontSize: 13,
                }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>方向</label>
                <select
                  value={form.side}
                  disabled={isEdit}
                  onChange={(e) => setForm({ ...form, side: e.target.value as 'buy' | 'sell' })}
                  style={{
                    width: '100%', height: 36, border: '1px solid var(--line)',
                    borderRadius: 8, padding: '0 10px', fontSize: 13,
                  }}
                >
                  <option value="buy">买入</option>
                  <option value="sell">卖出</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>
                  {form.side === 'buy' ? '买入金额' : '卖出金额'} (元)
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
                  style={{
                    width: '100%', height: 36, border: '1px solid var(--line)',
                    borderRadius: 8, padding: '0 10px', fontSize: 13,
                  }}
                />
              </div>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>
                {form.side === 'buy' ? '买入时间' : '卖出时间'}
              </label>
              <input
                type="datetime-local"
                required
                value={form.purchase_time}
                onChange={(e) => setForm({ ...form, purchase_time: e.target.value })}
                style={{
                  width: '100%', height: 36, border: '1px solid var(--line)',
                  borderRadius: 8, padding: '0 10px', fontSize: 13,
                }}
              />
              <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                系统将根据买入时间自动计算确认日期（15:00前T+1，15:00后T+2，跳过周末）
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button type="button" className="icon-button" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="primary-button" disabled={saving}>
              {saving ? '处理中...' : isEdit ? '保存修改' : '确认添加'}
            </button>
          </div>
        </form>
      </div>
    </DialogModal>
  )
}
