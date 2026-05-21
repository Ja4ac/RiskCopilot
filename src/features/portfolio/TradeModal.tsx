import React, { useEffect, useState, useRef } from 'react'
import { DialogModal } from '@/components/ui/DialogModal'
import type { IpcAddTradePayload, Trade } from '@/types'
import { ipcInvoke } from '@/hooks/useIPC'
import { IPC_CHANNELS } from '@/types'

export interface EditingTrade extends Trade {
  symbol?: string
  market?: string
  asset_name?: string
  asset_type?: string
}

/** Auto-detect exchange market from stock/fund code prefix */
export function detectMarket(symbol: string): string {
  if (/^\d{6}$/.test(symbol)) {
    return (symbol.startsWith('6') || symbol.startsWith('9')) ? 'SH' : 'SZ'
  }
  if (/^\d{5}$/.test(symbol)) return 'HK'
  if (/^[A-Z]+$/.test(symbol)) return 'US'
  return 'SZ'
}

// Helper: convert UTC ISO string to local datetime-local format (YYYY-MM-DDTHH:MM)
export function toDatetimeLocalValue(isoString: string | undefined): string {
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
export function fromDatetimeLocalValue(localValue: string): string {
  try {
    const d = new Date(localValue)
    if (isNaN(d.getTime())) return new Date().toISOString()
    return d.toISOString()
  } catch {
    return new Date().toISOString()
  }
}

// ─── Add / Edit Stock Trade Modal ──────────────────────────────────────
export function TradeModal({
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

  const [form, setForm] = useState({
    symbol: '',
    asset_name: '',
    account_id: 'default',
    side: 'buy' as 'buy' | 'sell',
    quantity: 100,
    price: 10,
    fee: 0,
    tax: 0,
    auto_calc_fee: false,
    trade_time: new Date().toISOString().slice(0, 16),
  })

  // Pre-fill form when editing or when modal opens
  useEffect(() => {
    if (!visible) return
    if (mode === 'edit' && trade) {
      const timeStr = toDatetimeLocalValue(trade.trade_time)
      setForm({
        symbol: trade.symbol || '',
        asset_name: trade.asset_name || '',
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
      setForm({
        symbol: '',
        asset_name: '',
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
  }, [visible])

  // Auto-resolve stock/ETF name from stock_listings when symbol changes
  useEffect(() => {
    if (!visible || isEdit || !form.symbol) return
    const sym = form.symbol.trim()
    if (sym.length < 4) return
    const timer = setTimeout(async () => {
      try {
        const result = await ipcInvoke<{ results: Array<{ listing: { name: string; asset_type: string } }> }>(IPC_CHANNELS.INSTRUMENT_SEARCH, {
          query: sym, limit: 5,
        })
        if (result?.results) {
          // Prefer stock/ETF entry over fund entry
          const match = result.results.find(r => r.listing?.asset_type !== 'fund')
          if (match?.listing?.name) {
            setForm(prev => prev.asset_name ? prev : { ...prev, asset_name: match.listing.name })
          }
        }
      } catch { /* non-blocking */ }
    }, 400)
    return () => clearTimeout(timer)
  }, [form.symbol, visible, isEdit])

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
    const market = detectMarket(form.symbol)
    onSave({
      symbol: form.symbol,
      market,
      asset_name: form.asset_name || form.symbol,
      asset_type: 'stock',
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
            <h2>{isEdit ? '编辑股票' : '添加股票'}</h2>
            <p>{isEdit ? '修改股票交易记录' : '录入一笔股票或ETF交易'}</p>
          </div>
          <button className="icon-button" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gap: 12, padding: '0 20px 20px' }}>
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
                placeholder="如: 002300"
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
                名称 <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(选填)</span>
              </label>
              <input
                placeholder="如: 太阳电缆"
                value={form.asset_name}
                onChange={(e) => setForm({ ...form, asset_name: e.target.value })}
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
                    {' '}(100股整数倍)
                  </span>
                </label>
                <input
                  type="number"
                  required
                  step={100}
                  min={100}
                  value={form.quantity}
                  onChange={(e) => {
                    const val = Number(e.target.value)
                    const adjusted = Math.round(val / 100) * 100
                    setForm({ ...form, quantity: Math.max(adjusted, 100) })
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
                    newFee = Math.max(5, Math.round(amount * 0.00025 * 100) / 100)
                    newTax = form.side === 'sell' ? Math.round(amount * 0.001 * 100) / 100 : 0
                  }
                  setForm({ ...form, auto_calc_fee: checked, fee: newFee, tax: newTax })
                }}
                style={{ width: 16, height: 16 }}
              />
              <label htmlFor="auto-calc-fee" style={{ fontSize: 13, cursor: 'pointer' }}>
                自动计算手续费
                <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}>
                  {' '}(佣金0.025%最低5元，卖出印花税0.1%)
                </span>
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>
                  手续费
                  <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}>
                    {' '}(佣金)
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
                    {' '}(仅卖出)
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
              {form.side === 'buy' && <span>A股/ETF买入仅收佣金（约成交金额的0.025%，最低5元）。</span>}
              {form.side === 'sell' && <span>A股/ETF卖出收佣金+印花税（成交金额的0.1%）。</span>}
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
