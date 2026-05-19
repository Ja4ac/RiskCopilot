// ============================================================
// Import utilities — shared between PortfolioService and tests
// ============================================================

export const BROKER_ALIASES: Record<string, string[]> = {
  symbol: ['symbol', '代码', '证券代码', '股票代码', '基金代码', 'code', 'ticker', 'sec_code', 'stock_code'],
  side: ['side', '方向', '买卖', '交易方向', 'buy_sell', 'trade_side', 'bs_flag', 'entrust_bs'],
  quantity: ['quantity', '数量', '成交数量', '委托数量', 'qty', 'vol', 'volume', 'shares'],
  price: ['price', '价格', '成交价格', '成交价', '委托价格', '成交均价', 'avg_price', 'trade_price', 'deal_price'],
  trade_time: ['trade_time', '交易时间', '成交时间', '委托时间', 'time', 'date', 'trade_date', 'order_time'],
  fee: ['fee', '手续费', '佣金', 'commission', 'brokerage', 'charge'],
  tax: ['tax', '印花税', '过户费', 'stamp_tax', 'transfer_fee'],
}

export function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        result.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
  }
  result.push(current.trim())
  return result
}

export function detectFieldMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim())

  for (const [targetField, aliases] of Object.entries(BROKER_ALIASES)) {
    for (const alias of aliases) {
      const idx = lowerHeaders.findIndex(
        (h) => h === alias.toLowerCase() || h.startsWith(alias.toLowerCase())
      )
      if (idx >= 0) {
        mapping[headers[idx]] = targetField
        break
      }
    }
  }

  return mapping
}

export function applyFieldMapping(rawData: Record<string, string>, mapping: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [header, value] of Object.entries(rawData)) {
    const target = mapping[header]
    if (target) {
      result[target] = value
    }
  }
  return result
}

export function validateImportRow(rawData: Record<string, string>, mapping: Record<string, string>): string[] {
  const errors: string[] = []
  const mapped = applyFieldMapping(rawData, mapping)

  if (!mapped.symbol) errors.push('缺少证券代码')
  if (!mapped.side) errors.push('缺少交易方向')
  else {
    const side = mapped.side.toLowerCase()
    if (side !== 'buy' && side !== 'sell' && side !== '买入' && side !== '卖出') {
      errors.push(`无效的交易方向: "${mapped.side}"`)
    }
  }
  if (mapped.quantity === undefined || mapped.quantity === '') errors.push('缺少数量')
  else if (isNaN(parseFloat(mapped.quantity)) || parseFloat(mapped.quantity) <= 0) {
    errors.push(`无效的数量: "${mapped.quantity}"`)
  }
  if (mapped.price === undefined || mapped.price === '') errors.push('缺少价格')
  else if (isNaN(parseFloat(mapped.price)) || parseFloat(mapped.price) <= 0) {
    errors.push(`无效的价格: "${mapped.price}"`)
  }

  return errors
}
