import { describe, it, expect, beforeEach } from 'vitest'

// ─── Helpers mirroring PositionsPage.tsx logic ─────────────────────

interface Trade {
  id: string
  asset_id: string
  account_id: string
  side: 'buy' | 'sell'
  quantity: number
  price: number
  fee: number
  tax: number
  trade_time: string
  source: string
  status: 'active' | 'voided'
  created_at: string
  asset?: {
    symbol: string
    market: string
    name: string
    asset_type: string
  }
}

interface EditingTrade extends Trade {
  symbol?: string
  market?: string
  asset_name?: string
  asset_type?: string
}

/** Simulate state management when opening add-trade modal */
function openAddTradeModal(
  setEditingTrade: (v: EditingTrade | null) => void,
  setEditingFundTrade: (v: Trade | null) => void,
  setShowModal: (v: boolean) => void,
  setShowFundModal: (v: boolean) => void
) {
  setEditingTrade(null)
  setEditingFundTrade(null)
  setShowModal(true)
  setShowFundModal(false)
}

/** Simulate state management when opening add-fund modal */
function openAddFundModal(
  setEditingTrade: (v: EditingTrade | null) => void,
  setEditingFundTrade: (v: Trade | null) => void,
  setShowModal: (v: boolean) => void,
  setShowFundModal: (v: boolean) => void
) {
  setEditingTrade(null)
  setEditingFundTrade(null)
  setShowModal(false)
  setShowFundModal(true)
}

/** Simulate clicking edit on a regular trade */
function editRegularTrade(
  trade: Trade,
  setEditingTrade: (v: EditingTrade | null) => void,
  setEditingFundTrade: (v: Trade | null) => void,
  setShowModal: (v: boolean) => void,
  setShowFundModal: (v: boolean) => void
) {
  setEditingFundTrade(null)
  setShowFundModal(false)
  setEditingTrade({
    ...trade,
    symbol: trade.asset?.symbol,
    market: trade.asset?.market,
    asset_name: trade.asset?.name,
    asset_type: trade.asset?.asset_type,
  })
  setShowModal(true)
}

/** Simulate clicking edit on a fund trade */
function editFundTrade(
  trade: Trade,
  setEditingTrade: (v: EditingTrade | null) => void,
  setEditingFundTrade: (v: Trade | null) => void,
  setShowModal: (v: boolean) => void,
  setShowFundModal: (v: boolean) => void
) {
  setEditingTrade(null)
  setShowModal(false)
  setEditingFundTrade(trade)
  setShowFundModal(true)
}

/** Compute key prop for TradeModal */
function getTradeModalKey(editingTrade: EditingTrade | null): string {
  return editingTrade ? editingTrade.id : 'new-trade'
}

/** Compute key prop for FundPurchaseModal */
function getFundModalKey(editingFundTrade: Trade | null): string {
  return editingFundTrade ? editingFundTrade.id : 'new-fund'
}

/** Simulate editingTrade amount calculation */
function computeFundEditAmount(trade: Trade): number {
  return Math.round(trade.quantity * trade.price * 100) / 100
}

/** Simulate TradeModal form init */
function initTradeForm(trade: EditingTrade | null | undefined, visible: boolean) {
  if (!visible) return null
  if (trade) {
    const isFund = trade.asset_type === 'fund' || trade.market === 'OF'
    return {
      symbol: trade.symbol || '',
      market: isFund ? 'OTC' : (trade.market || 'SZ'),
      asset_name: trade.asset_name || '',
      asset_type: isFund ? 'fund' : ((trade.asset_type as 'stock' | 'fund' | 'etf') || 'stock'),
      quantity: trade.quantity || 0,
      price: trade.price || 0,
      fee: trade.fee || 0,
      tax: trade.tax || 0,
    }
  }
  return {
    symbol: '',
    market: 'SZ',
    asset_name: '',
    asset_type: 'stock' as const,
    quantity: 100,
    price: 10,
    fee: 0,
    tax: 0,
  }
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('Edit State Management', () => {
  let editingTrade: EditingTrade | null
  let editingFundTrade: Trade | null
  let showModal: boolean
  let showFundModal: boolean

  const setEditingTrade = (v: EditingTrade | null) => { editingTrade = v }
  const setEditingFundTrade = (v: Trade | null) => { editingFundTrade = v }
  const setShowModal = (v: boolean) => { showModal = v }
  const setShowFundModal = (v: boolean) => { showFundModal = v }

  beforeEach(() => {
    editingTrade = null
    editingFundTrade = null
    showModal = false
    showFundModal = false
  })

  it('openAddTradeModal resets both editing states', () => {
    // Pre-set some state
    editingFundTrade = { id: 'f1' } as Trade
    showFundModal = true

    openAddTradeModal(setEditingTrade, setEditingFundTrade, setShowModal, setShowFundModal)

    expect(editingTrade).toBeNull()
    expect(editingFundTrade).toBeNull()
    expect(showModal).toBe(true)
    expect(showFundModal).toBe(false)
  })

  it('openAddFundModal resets both editing states', () => {
    // Pre-set some state
    editingTrade = { id: 't1' } as EditingTrade
    showModal = true

    openAddFundModal(setEditingTrade, setEditingFundTrade, setShowModal, setShowFundModal)

    expect(editingTrade).toBeNull()
    expect(editingFundTrade).toBeNull()
    expect(showModal).toBe(false)
    expect(showFundModal).toBe(true)
  })

  it('editRegularTrade sets editingTrade and clears fund state', () => {
    const trade: Trade = {
      id: 't1',
      asset_id: 'a1',
      account_id: 'default',
      side: 'buy',
      quantity: 100,
      price: 10,
      fee: 0,
      tax: 0,
      trade_time: '2024-05-13T10:00:00Z',
      source: 'manual',
      status: 'active',
      created_at: '2024-05-13T10:00:00Z',
      asset: {
        symbol: '300750',
        market: 'SZ',
        name: '宁德时代',
        asset_type: 'stock',
      },
    }

    // Pre-set fund state
    editingFundTrade = { id: 'f1' } as Trade
    showFundModal = true

    editRegularTrade(trade, setEditingTrade, setEditingFundTrade, setShowModal, setShowFundModal)

    expect(editingTrade).not.toBeNull()
    expect(editingTrade?.id).toBe('t1')
    expect(editingTrade?.symbol).toBe('300750')
    expect(editingTrade?.market).toBe('SZ')
    expect(editingFundTrade).toBeNull()
    expect(showModal).toBe(true)
    expect(showFundModal).toBe(false)
  })

  it('editFundTrade sets editingFundTrade and clears regular state', () => {
    const trade: Trade = {
      id: 'f1',
      asset_id: 'a2',
      account_id: 'default',
      side: 'buy',
      quantity: 266.28,
      price: 1.8777,
      fee: 0,
      tax: 0,
      trade_time: '2024-04-24T00:00:00Z',
      source: 'fund_purchase',
      status: 'active',
      created_at: '2024-04-24T00:00:00Z',
      asset: {
        symbol: '025209',
        market: 'OF',
        name: '某基金',
        asset_type: 'fund',
      },
    }

    // Pre-set regular state
    editingTrade = { id: 't1' } as EditingTrade
    showModal = true

    editFundTrade(trade, setEditingTrade, setEditingFundTrade, setShowModal, setShowFundModal)

    expect(editingFundTrade).not.toBeNull()
    expect(editingFundTrade?.id).toBe('f1')
    expect(editingTrade).toBeNull()
    expect(showModal).toBe(false)
    expect(showFundModal).toBe(true)
  })

  it('TradeModal key changes when editing different trades', () => {
    const trade1 = { id: 't1' } as EditingTrade
    const trade2 = { id: 't2' } as EditingTrade

    expect(getTradeModalKey(trade1)).toBe('t1')
    expect(getTradeModalKey(trade2)).toBe('t2')
    expect(getTradeModalKey(null)).toBe('new-trade')
  })

  it('FundPurchaseModal key changes when editing different funds', () => {
    const trade1 = { id: 'f1' } as Trade
    const trade2 = { id: 'f2' } as Trade

    expect(getFundModalKey(trade1)).toBe('f1')
    expect(getFundModalKey(trade2)).toBe('f2')
    expect(getFundModalKey(null)).toBe('new-fund')
  })
})

describe('Fund Edit Amount Calculation', () => {
  it('computes correct amount for 025209 first purchase', () => {
    const trade: Trade = {
      id: 'f1',
      asset_id: 'a1',
      account_id: 'default',
      side: 'buy',
      quantity: 266.28,
      price: 1.8777,
      fee: 0,
      tax: 0,
      trade_time: '2024-04-24T00:00:00Z',
      source: 'fund_purchase',
      status: 'active',
      created_at: '2024-04-24T00:00:00Z',
    }
    expect(computeFundEditAmount(trade)).toBe(499.99)
  })

  it('computes correct amount for 025209 second purchase', () => {
    const trade: Trade = {
      id: 'f2',
      asset_id: 'a1',
      account_id: 'default',
      side: 'buy',
      quantity: 221.09,
      price: 2.2615,
      fee: 0,
      tax: 0,
      trade_time: '2024-05-13T00:00:00Z',
      source: 'fund_purchase',
      status: 'active',
      created_at: '2024-05-13T00:00:00Z',
    }
    expect(computeFundEditAmount(trade)).toBe(500)
  })

  it('computes correct amount for 018927 purchase', () => {
    const trade: Trade = {
      id: 'f3',
      asset_id: 'a2',
      account_id: 'default',
      side: 'buy',
      quantity: 369.59,
      price: 1.8940,
      fee: 0,
      tax: 0,
      trade_time: '2024-05-07T00:00:00Z',
      source: 'fund_purchase',
      status: 'active',
      created_at: '2024-05-07T00:00:00Z',
    }
    expect(computeFundEditAmount(trade)).toBe(700)
  })
})

describe('TradeModal Form Initialization', () => {
  it('initializes form with trade data when visible and editing', () => {
    const trade: EditingTrade = {
      id: 't1',
      asset_id: 'a1',
      account_id: 'default',
      side: 'buy',
      quantity: 100,
      price: 10,
      fee: 0.5,
      tax: 0.1,
      trade_time: '2024-05-13T10:00:00Z',
      source: 'manual',
      status: 'active',
      created_at: '2024-05-13T10:00:00Z',
      symbol: '300750',
      market: 'SZ',
      asset_name: '宁德时代',
      asset_type: 'stock',
    }

    const form = initTradeForm(trade, true)
    expect(form).toEqual({
      symbol: '300750',
      market: 'SZ',
      asset_name: '宁德时代',
      asset_type: 'stock',
      quantity: 100,
      price: 10,
      fee: 0.5,
      tax: 0.1,
    })
  })

  it('initializes form with defaults when visible and adding', () => {
    const form = initTradeForm(null, true)
    expect(form).toEqual({
      symbol: '',
      market: 'SZ',
      asset_name: '',
      asset_type: 'stock',
      quantity: 100,
      price: 10,
      fee: 0,
      tax: 0,
    })
  })

  it('returns null when not visible', () => {
    const trade: EditingTrade = {
      id: 't1',
      asset_id: 'a1',
      account_id: 'default',
      side: 'buy',
      quantity: 100,
      price: 10,
      fee: 0,
      tax: 0,
      trade_time: '2024-05-13T10:00:00Z',
      source: 'manual',
      status: 'active',
      created_at: '2024-05-13T10:00:00Z',
      symbol: '300750',
      market: 'SZ',
      asset_name: '宁德时代',
      asset_type: 'stock',
    }

    const form = initTradeForm(trade, false)
    expect(form).toBeNull()
  })

  it('detects fund type from asset_type', () => {
    const trade: EditingTrade = {
      id: 'f1',
      asset_id: 'a1',
      account_id: 'default',
      side: 'buy',
      quantity: 266.28,
      price: 1.8777,
      fee: 0,
      tax: 0,
      trade_time: '2024-04-24T00:00:00Z',
      source: 'fund_purchase',
      status: 'active',
      created_at: '2024-04-24T00:00:00Z',
      symbol: '025209',
      market: 'OF',
      asset_name: '某基金',
      asset_type: 'fund',
    }

    const form = initTradeForm(trade, true)
    expect(form?.asset_type).toBe('fund')
    expect(form?.market).toBe('OTC')
  })

  it('detects fund type from market=OF even if asset_type missing', () => {
    const trade: EditingTrade = {
      id: 'f1',
      asset_id: 'a1',
      account_id: 'default',
      side: 'buy',
      quantity: 266.28,
      price: 1.8777,
      fee: 0,
      tax: 0,
      trade_time: '2024-04-24T00:00:00Z',
      source: 'fund_purchase',
      status: 'active',
      created_at: '2024-04-24T00:00:00Z',
      symbol: '025209',
      market: 'OF',
      asset_name: '某基金',
      // asset_type intentionally missing
    }

    const form = initTradeForm(trade, true)
    expect(form?.asset_type).toBe('fund')
    expect(form?.market).toBe('OTC')
  })
})

describe('Modal Key Stability', () => {
  it('TradeModal key remains stable for same trade', () => {
    const trade = { id: 't1' } as EditingTrade
    const key1 = getTradeModalKey(trade)
    const key2 = getTradeModalKey(trade)
    expect(key1).toBe(key2)
  })

  it('FundPurchaseModal key remains stable for same trade', () => {
    const trade = { id: 'f1' } as Trade
    const key1 = getFundModalKey(trade)
    const key2 = getFundModalKey(trade)
    expect(key1).toBe(key2)
  })
})
