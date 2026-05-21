// ============================================================
// Portfolio services — barrel export with dependency wiring
// ============================================================

import { FundTradeService } from './FundTradeService'
import { PositionService } from './PositionService'
import { PortfolioQueryService } from './PortfolioQueryService'
import { TradeService } from './TradeService'
import { ImportService } from './ImportService'

export { TradeService } from './TradeService'
export { PositionService } from './PositionService'
export { ImportService } from './ImportService'
export { FundTradeService } from './FundTradeService'
export { PortfolioQueryService } from './PortfolioQueryService'

// ── Wired singleton factory ──────────────────────────────
// Creates all 5 services with cross-service dependencies properly injected.
// Order matters to break circular dependencies:
//   1. FundTradeService (only depends on getDb + data-proxy)
//   2. PositionService (depends on getPrevNav + getDayBeforeNav from FundTradeService)
//   3. PortfolioQueryService (depends on getPositionsWithDetails from PositionService)
//   4. TradeService (depends on recalculatePosition + recordDailyPortfolioValue)
//   5. ImportService (depends on recalculatePosition from PositionService)

let _fundTrade: FundTradeService | null = null
let _position: PositionService | null = null
let _query: PortfolioQueryService | null = null
let _trade: TradeService | null = null
let _import: ImportService | null = null

export function getFundTradeService(): FundTradeService {
  if (!_fundTrade) {
    // Create FundTradeService first with placeholder deps (wired after position/query exist)
    _fundTrade = new FundTradeService(
      (assetId, accountId) => getPositionService().recalculatePosition(assetId, accountId),
      () => getPortfolioQueryService().recordDailyPortfolioValue()
    )
  }
  return _fundTrade
}

export function getPositionService(): PositionService {
  if (!_position) {
    _position = new PositionService(
      (symbol, market) => getFundTradeService().getPrevNav(symbol, market),
      (symbol, market) => getFundTradeService().getDayBeforeNav(symbol, market)
    )
  }
  return _position
}

export function getPortfolioQueryService(): PortfolioQueryService {
  if (!_query) {
    _query = new PortfolioQueryService(
      () => getPositionService().getPositionsWithDetails()
    )
  }
  return _query
}

export function getTradeService(): TradeService {
  if (!_trade) {
    _trade = new TradeService(
      (assetId, accountId) => getPositionService().recalculatePosition(assetId, accountId),
      () => getPortfolioQueryService().recordDailyPortfolioValue()
    )
  }
  return _trade
}

export function getImportService(): ImportService {
  if (!_import) {
    _import = new ImportService(
      (assetId, accountId) => getPositionService().recalculatePosition(assetId, accountId)
    )
  }
  return _import
}
