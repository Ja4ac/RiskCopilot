import { describe, it, expect } from 'vitest'
import { parseCSVLine, detectFieldMapping, applyFieldMapping, validateImportRow } from '../../electron/utils/import-utils'

describe('CSV Parsing', () => {
  it('parses simple comma-separated line', () => {
    const result = parseCSVLine('300750,buy,100,205.50,2026-01-01')
    expect(result).toEqual(['300750', 'buy', '100', '205.50', '2026-01-01'])
  })

  it('handles quoted fields with commas inside', () => {
    const result = parseCSVLine('300750,"buy,sell",100,205.50,2026-01-01')
    expect(result).toEqual(['300750', 'buy,sell', '100', '205.50', '2026-01-01'])
  })

  it('handles escaped quotes inside quoted fields', () => {
    const simple = parseCSVLine('"""hello""",world')
    expect(simple[0]).toBe('"hello"')
    expect(simple[1]).toBe('world')
  })

  it('handles empty trailing fields', () => {
    const result = parseCSVLine('300750,buy,100,,')
    expect(result).toEqual(['300750', 'buy', '100', '', ''])
  })
})

describe('Field Mapping (Broker Aliases)', () => {
  it('detects standard English headers', () => {
    const mapping = detectFieldMapping(['symbol', 'side', 'quantity', 'price', 'trade_time'])
    expect(mapping['symbol']).toBe('symbol')
    expect(mapping['side']).toBe('side')
    expect(mapping['quantity']).toBe('quantity')
    expect(mapping['price']).toBe('price')
    expect(mapping['trade_time']).toBe('trade_time')
  })

  it('detects Chinese broker headers (东方财富 format)', () => {
    const mapping = detectFieldMapping(['证券代码', '买卖方向', '成交数量', '成交均价', '成交时间'])
    expect(mapping['证券代码']).toBe('symbol')
    expect(mapping['买卖方向']).toBe('side')
    expect(mapping['成交数量']).toBe('quantity')
    expect(mapping['成交均价']).toBe('price')
    expect(mapping['成交时间']).toBe('trade_time')
  })

  it('detects common broker aliases', () => {
    const mapping = detectFieldMapping(['stock_code', 'bs_flag', 'shares', 'deal_price', 'order_time'])
    expect(mapping['stock_code']).toBe('symbol')
    expect(mapping['bs_flag']).toBe('side')
    expect(mapping['shares']).toBe('quantity')
    expect(mapping['deal_price']).toBe('price')
    expect(mapping['order_time']).toBe('trade_time')
  })

  it('handles mixed Chinese-English headers', () => {
    const mapping = detectFieldMapping(['代码', '方向', '数量', '价格', '成交时间'])
    expect(mapping['代码']).toBe('symbol')
    expect(mapping['方向']).toBe('side')
    expect(mapping['数量']).toBe('quantity')
    expect(mapping['价格']).toBe('price')
    expect(mapping['成交时间']).toBe('trade_time')
  })
})

describe('Field Mapping Application', () => {
  it('maps raw CSV data using detected mapping', () => {
    const raw = { '证券代码': '300750', '买卖方向': '买入', '成交数量': '100', '成交均价': '205.50' }
    const mapping = { '证券代码': 'symbol', '买卖方向': 'side', '成交数量': 'quantity', '成交均价': 'price' }
    const mapped = applyFieldMapping(raw, mapping)
    expect(mapped.symbol).toBe('300750')
    expect(mapped.side).toBe('买入')
    expect(mapped.quantity).toBe('100')
    expect(mapped.price).toBe('205.50')
  })
})

describe('Import Row Validation', () => {
  it('accepts valid row', () => {
    const errors = validateImportRow({
      symbol: '300750', side: 'buy', quantity: '100', price: '205.50'
    }, { symbol: 'symbol', side: 'side', quantity: 'quantity', price: 'price' })
    expect(errors).toHaveLength(0)
  })

  it('accepts Chinese side labels (买入/卖出)', () => {
    const errors = validateImportRow({
      symbol: '300750', side: '买入', quantity: '100', price: '205.50'
    }, { symbol: 'symbol', side: 'side', quantity: 'quantity', price: 'price' })
    expect(errors).toHaveLength(0)
  })

  it('rejects missing symbol', () => {
    const errors = validateImportRow({ side: 'buy', quantity: '100', price: '205.50' }, { side: 'side', quantity: 'quantity', price: 'price' })
    expect(errors).toContain('缺少证券代码')
  })

  it('rejects invalid side', () => {
    const errors = validateImportRow({
      symbol: '300750', side: 'transfer', quantity: '100', price: '205.50'
    }, { symbol: 'symbol', side: 'side', quantity: 'quantity', price: 'price' })
    expect(errors.some(e => e.includes('无效的交易方向'))).toBe(true)
  })

  it('rejects invalid quantity', () => {
    const errors = validateImportRow({ symbol: '300750', side: 'buy', quantity: '-5', price: '205.50' }, { symbol: 'symbol', side: 'side', quantity: 'quantity', price: 'price' })
    expect(errors.some(e => e.includes('无效的数量'))).toBe(true)
  })

  it('rejects invalid price', () => {
    const errors = validateImportRow({ symbol: '300750', side: 'buy', quantity: '100', price: 'abc' }, { symbol: 'symbol', side: 'side', quantity: 'quantity', price: 'price' })
    expect(errors.some(e => e.includes('无效的价格'))).toBe(true)
  })
})
