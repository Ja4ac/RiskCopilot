// ============================================================
// IPC Channel Names & Payload Types
// ============================================================

import type {
  PositionWithAsset,
  PortfolioSummary,
  Trade,
  Asset,
  MarketQuote,
  KlineBar,
  KlinePeriod,
  IndicatorType,
  IndicatorValues,
  RiskSummary,
  ExposureItem,
  CorrelationPair,
  StressTestScenario,
  StressTestResult,
  NewsWithAsset,
  Importance,
  Alert,
  AlertRule,
  AlertStatus,
  AIChatMessage,
  AIChatContext,
  Report,
  ReportType,
  AppSettings,
  ImportPreviewResult,
  ImportCommitResult,
  AIProviderConfigSafe,
  MarketProviderStatus
} from './database'

// ---- IPC Channel Names ----

export const IPC_CHANNELS = {
  // Portfolio
  PORTFOLIO_GET_POSITIONS: 'portfolio:getPositions',
  PORTFOLIO_GET_SUMMARY: 'portfolio:getSummary',
  PORTFOLIO_ADD_TRADE: 'portfolio:addTrade',
  PORTFOLIO_UPDATE_TRADE: 'portfolio:updateTrade',
  PORTFOLIO_VOID_TRADE: 'portfolio:voidTrade',
  PORTFOLIO_IMPORT_CSV: 'portfolio:importCsv',
  PORTFOLIO_EXPORT_CSV: 'portfolio:exportCsv',
  PORTFOLIO_GET_TRADES: 'portfolio:getTrades',
  PORTFOLIO_GET_ASSETS: 'portfolio:getAssets',
  PORTFOLIO_IMPORT_PREVIEW: 'portfolio:importPreview',
  PORTFOLIO_IMPORT_FILE: 'portfolio:importFile',
  PORTFOLIO_UPSERT_ASSET: 'portfolio:upsertAsset',
  PORTFOLIO_ADD_FUND_PURCHASE: 'portfolio:addFundPurchase',
  PORTFOLIO_GET_FUND_PERFORMANCE: 'portfolio:getFundPerformance',
  PORTFOLIO_GET_PORTFOLIO_PERFORMANCE: 'portfolio:getPortfolioPerformance',

  // Market
  MARKET_GET_QUOTES: 'market:getQuotes',
  MARKET_GET_KLINE: 'market:getKline',
  MARKET_FETCH_KLINE: 'market:fetchKline',
  MARKET_GET_INDICATORS: 'market:getIndicators',
  MARKET_SYNC_QUOTES: 'market:syncQuotes',
  MARKET_GET_SOURCE_STATUS: 'market:getSourceStatus',

  // Risk
  RISK_GET_SUMMARY: 'risk:getSummary',
  RISK_GET_EXPOSURE: 'risk:getExposure',
  RISK_GET_CORRELATION: 'risk:getCorrelation',
  RISK_STRESS_TEST: 'risk:stressTest',

  // News
  NEWS_GET_LIST: 'news:getList',
  NEWS_GET_ASSET_NEWS: 'news:getAssetNews',

  // Alerts
  ALERT_GET_LIST: 'alert:getList',
  ALERT_CREATE_RULE: 'alert:createRule',
  ALERT_DELETE_RULE: 'alert:deleteRule',
  ALERT_ACKNOWLEDGE: 'alert:acknowledge',
  ALERT_EVALUATE: 'alert:evaluate',

  // AI
  AI_CHAT: 'ai:chat',
  AI_SUMMARIZE_NEWS: 'ai:summarizeNews',
  AI_EXPLAIN_RISK: 'ai:explainRisk',
  AI_GENERATE_REPORT: 'ai:generateReport',
  AI_TEST_PROVIDER: 'ai:testProvider',
  AI_SET_ACTIVE_PROVIDER: 'ai:setActiveProvider',
  AI_GET_PROVIDER_STATUS: 'ai:getProviderStatus',
  AI_GET_PROVIDERS: 'ai:getProviders',
  AI_SAVE_PROVIDER: 'ai:saveProvider',
  AI_DELETE_PROVIDER: 'ai:deleteProvider',

  // Reports
  REPORT_GET_LIST: 'report:getList',
  REPORT_GET_DETAIL: 'report:getDetail',
  REPORT_DELETE: 'report:delete',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
  SETTINGS_TEST_DATA_SOURCE: 'settings:testDataSource',

  // Market Data Sources
  MARKET_LIST_SOURCES: 'market:listSources',
  MARKET_SAVE_SOURCE: 'market:saveSource',
  MARKET_DELETE_SOURCE: 'market:deleteSource',
  MARKET_SET_ACTIVE_SOURCE: 'market:setActiveSource',

  // Stock Listings (legacy — will be migrated to Instrument layer)
  LISTING_GET: 'listing:get',
  LISTING_SEARCH: 'listing:search',
  LISTING_REFRESH: 'listing:refresh',
  LISTING_COUNT: 'listing:count',
  LISTING_SYNC_QUOTES: 'listing:syncQuotes',

  // Instrument Master Data
  INSTRUMENT_SEARCH: 'instrument:search',
  INSTRUMENT_GET_DETAIL: 'instrument:getDetail',
  INSTRUMENT_REFRESH: 'instrument:refresh',

  // Market Snapshots
  MARKET_GET_SNAPSHOT: 'market:getSnapshot',
  MARKET_GET_FUND_NAV: 'market:getFundNav',

  // Watchlist
  WATCHLIST_LIST: 'watchlist:list',
  WATCHLIST_ADD: 'watchlist:add',
  WATCHLIST_REMOVE: 'watchlist:remove',
  WATCHLIST_REFRESH: 'watchlist:refresh',
  WATCHLIST_GET_DETAIL: 'watchlist:getDetail',

  // News Data Sources
  NEWS_LIST_SOURCES: 'news:listSources',
  NEWS_SAVE_SOURCE: 'news:saveSource',
  NEWS_DELETE_SOURCE: 'news:deleteSource',
  NEWS_SET_ACTIVE_SOURCE: 'news:setActiveSource',
  NEWS_SYNC: 'news:sync',

  // App
  APP_OPEN_FILE: 'app:openFile',
  APP_EXPORT_FILE: 'app:exportFile',
  APP_GET_DATA_SOURCE_STATUS: 'app:getDataSourceStatus',
  APP_GET_STATE: 'app:getState',
  APP_SEED_DATA: 'app:seedData'
} as const

// ---- IPC Payload Types ----

export interface IpcAddTradePayload {
  asset_id?: string
  symbol?: string
  market?: string
  asset_name?: string
  account_id: string
  side: 'buy' | 'sell'
  quantity: number
  price: number
  fee?: number
  tax?: number
  trade_time: string
  source?: string
  asset_type?: string
  currency?: string
}

export interface IpcImportCsvResult {
  success: boolean
  imported: number
  errors: string[]
}

export interface IpcGetKlinePayload {
  asset_id: string
  period: KlinePeriod
  from?: string
  to?: string
}

export interface IpcGetIndicatorsPayload {
  asset_id: string
  period: KlinePeriod
  types: IndicatorType[]
}

export interface IpcStressTestPayload {
  scenario_ids: string[]
}

export interface IpcGetNewsPayload {
  importance?: Importance
  asset_id?: string
  limit?: number
  offset?: number
}

export interface IpcCreateAlertPayload {
  alert_type: string
  target_type: string
  target_id: string
  rule_json: Record<string, unknown>
}

export interface IpcChatPayload {
  message: string
  context?: AIChatContext
}

export interface IpcGenerateReportPayload {
  report_type: ReportType
  params?: Record<string, unknown>
}

export interface IpcImportPreviewPayload {
  filePath: string
  accountId?: string
}

export interface IpcImportFilePayload {
  filePath: string
  accountId?: string
  fieldMapping: Record<string, string>
}

export interface IpcUpsertAssetPayload {
  symbol: string
  market: string
  name?: string
  asset_type?: string
  currency?: string
}

export interface IpcAddFundPurchasePayload {
  symbol: string
  name?: string
  amount: number
  purchase_time: string
  account_id?: string
  side?: 'buy' | 'sell'
}

export interface IpcSaveProviderPayload {
  id?: string
  provider: string
  name: string
  base_url?: string
  api_key?: string
  model?: string
  is_enabled?: boolean
}

export interface IpcTestProviderPayload {
  provider_id: string
}

export interface IpcExportFilePayload {
  defaultName: string
  content: string
}

export interface IpcSaveMarketSourcePayload {
  id?: string
  name: string
  base_url: string
  is_enabled?: boolean
}

export interface IpcTestDataSourcePayload {
  source_type: 'market' | 'news' | 'ai'
  source_id?: string
  base_url?: string
}

export interface IpcGetListingsPayload {
  asset_type?: string
  limit?: number
  offset?: number
}

export interface IpcSearchListingsPayload {
  query: string
  asset_type?: string
  limit?: number
  offset?: number
}

export interface IpcInstrumentSearchPayload {
  query: string
  asset_type?: string
  limit?: number
  offset?: number
}

export interface IpcInstrumentDetailPayload {
  symbol: string
  market: string
}

export interface IpcMarketSnapshotPayload {
  symbol: string
  market: string
}

export interface IpcMarketFundNavPayload {
  symbol: string
  market: string
}

export interface IpcWatchlistAddPayload {
  symbol: string
  market: string
  name?: string
  asset_type?: string
  origin?: 'manual' | 'trade'
  notes?: string
}

export interface IpcWatchlistRemovePayload {
  asset_id: string
}

export interface IpcWatchlistDetailPayload {
  asset_id: string
}
