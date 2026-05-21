import React, { useEffect, useState, useRef } from 'react'
import { DialogModal } from '@/components/ui/DialogModal'
import { toDatetimeLocalValue } from '@/features/portfolio/TradeModal'
import { ipcInvoke } from '@/hooks/useIPC'
import { IPC_CHANNELS } from '@/types'

// ─── Fund Purchase Modal ───────────────────────────────────────────
export function FundPurchaseModal({
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

  // Auto-resolve fund name from stock_listings when symbol changes
  useEffect(() => {
    if (!visible || isEdit || !form.symbol) return
    const sym = form.symbol.trim()
    if (sym.length < 4) return
    const timer = setTimeout(async () => {
      try {
        const result = await ipcInvoke<{ results: Array<{ listing: { name: string } }> }>(IPC_CHANNELS.INSTRUMENT_SEARCH, {
          query: sym, asset_type: 'fund', limit: 3,
        })
        // Only auto-fill if the name field is empty (user hasn't typed manually)
        if (result?.results?.length === 1 && result.results[0].listing?.name) {
          setForm(prev => prev.name ? prev : { ...prev, name: result.results[0].listing.name })
        }
      } catch { /* name resolution non-blocking */ }
    }, 500)
    return () => clearTimeout(timer)
  }, [form.symbol, visible, isEdit])

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
