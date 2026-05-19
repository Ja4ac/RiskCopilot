// ============================================================
// Shared Database Types — used by both main & renderer processes
// ============================================================

// ============================================================
// Asset & Market Types
// ============================================================

export type AssetType =
  | 'stock'
  | 'fund'
  | 'etf'
  | 'lof'
  | 'index'
  | 'bond'
  | 'convertible_bond'
  | 'money_market_fund'
  | 'qdii'
  | 'reit'
  | 'cash'
  | 'other'

export type Market = 'SH' | 'SZ' | 'HK' | 'US' | 'OF'
export type TradeSide = 'buy' | 'sell'
export type TradeStatus = 'active' | 'voided'
export type AlertType =
  | 'price_threshold'
  | 'stop_loss'
  | 'stop_profit'
  | 'drawdown'
  | 'concentration'
  | 'var_breach'
  | 'news_keyword'
  | 'data_source'
export type AlertStatus = 'pending' | 'triggered' | 'acknowledged' | 'resolved' | 'archived'
export type Importance = 'high' | 'medium' | 'low'
export type ReportType = 'daily' | 'weekly' | 'monthly' | 'risk_assessment' | 'asset_analysis' | 'fund_comparison'
export type KlinePeriod = '1d' | '1w' | '1M'
export type IndicatorType = 'MA' | 'MACD' | 'BOLL' | 'KDJ' | 'RSI'

export interface Asset {
  id: string
  symbol: string
  market: Market
  name: string
  asset_type: AssetType
  currency: string
  industry: string | null
  style: string | null
  exchange: string | null
  created_at: string
  updated_at: string
}

export interface Trade {
  id: string
  asset_id: string
  account_id: string
  side: TradeSide
  quantity: number
  price: number
  fee: number
  tax: number
  trade_time: string
  source: string
  status: TradeStatus
  created_at: string
  /** Joined asset info (populated by getTrades when available) */
  asset?: {
    symbol: string
    market: Market
    name: string
    asset_type: AssetType
  }
}

export interface Position {
  id: string
  asset_id: string
  account_id: string
  quantity: number
  avg_cost: number
  cost_amount: number
  market_value: number
  unrealized_pnl: number
  updated_at: string
}

export interface MarketQuote {
  id: string
  asset_id: string
  symbol: string // 原始代码，用于回匹配
  market: string // 原始市场，用于回匹配
  price: number
  change_pct: number | null
  volume: number | null
  turnover: number | null
  quote_time: string
  source: string
  provider_symbol?: string // 供应商原始代码（如 sh600519）
}

export interface KlineBar {
  id: string
  asset_id: string
  period: KlinePeriod
  open: number
  high: number
  low: number
  close: number
  volume: number | null
  bar_time: string
  source: string
}

export interface RiskSnapshot {
  id: string
  portfolio_id: string
  risk_score: number
  volatility: number | null
  max_drawdown: number | null
  sharpe_ratio: number | null
  beta: number | null
  var_95: number | null
  concentration_score: number | null
  correlation_score: number | null
  liquidity_score: number | null
  sentiment_score: number | null
  calculated_at: string
}

export interface NewsItem {
  id: string
  title: string
  summary: string | null
  source: string
  url: string | null
  published_at: string
  sentiment: number | null
  importance: Importance
  raw_hash: string
  created_at: string
}

export interface NewsAssetLink {
  id: string
  news_id: string
  asset_id: string
  relevance: number
  event_type: string | null
}

export interface Alert {
  id: string
  alert_type: AlertType
  target_type: string
  target_id: string
  rule_json: string
  status: AlertStatus
  triggered_at: string | null
  acknowledged_at: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export interface AlertRule {
  type: AlertType
  target_type: string
  target_id: string
  condition: Record<string, unknown>
  threshold: number
  message_template: string
}

export interface Report {
  id: string
  report_type: ReportType
  title: string
  content_markdown: string
  source_context_json: string | null
  created_at: string
}

export interface CorporateAction {
  id: string
  asset_id: string
  action_type: 'split' | 'dividend' | 'bonus' | 'rights_issue'
  ex_date: string
  value: number
  note: string | null
}

// ============================================================
// Composite / display types
// ============================================================

export interface PositionWithAsset extends Position {
  asset: Asset
  quote: MarketQuote | null
  weight_pct: number
  daily_pnl: number
  yesterday_pnl: number
  total_return_pct: number
  risk_tag: 'low' | 'medium' | 'high' | 'critical'
  news_sentiment: 'positive' | 'neutral' | 'negative' | null
}

export interface PortfolioSummary {
  total_assets: number
  total_market_value: number
  total_cost: number
  today_pnl: number
  today_pnl_pct: number
  yesterday_pnl: number
  yesterday_pnl_pct: number
  cumulative_pnl: number
  cumulative_return_pct: number
  risk_score: number
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  position_count: number
}

export interface RiskSummary {
  /** 0 = low risk, 100 = high risk */
  risk_score: number
  /** 0 = unhealthy, 100 = very healthy (inverse of risk_score for display) */
  health_score: number
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  /** Annualized volatility as decimal (e.g., 0.15 = 15%). UI should format as %. */
  volatility: number
  /** Max drawdown as decimal (e.g., 0.20 = 20%). UI should format as %. */
  max_drawdown: number
  sharpe_ratio: number
  beta: number
  var_95: number
  concentration_score: number
  correlation_score: number
  volatility_score: number
  drawdown_score: number
  liquidity_score: number
  sentiment_score: number
  alert_score: number
}

export interface ExposureItem {
  category: string
  category_type: 'industry' | 'market' | 'asset_type' | 'style'
  weight_pct: number
  market_value: number
}

export interface CorrelationPair {
  asset_a: string
  asset_b: string
  asset_a_name: string
  asset_b_name: string
  correlation: number
}

export interface StressTestScenario {
  id: string
  name: string
  description: string
  type: 'historical' | 'hypothetical'
  shocks: StressShock[]
}

export interface StressShock {
  target: string
  target_type: 'market' | 'industry' | 'asset'
  change_pct: number
}

export interface StressTestResult {
  scenario_id: string
  scenario_name: string
  estimated_loss_amount: number
  estimated_loss_pct: number
  new_portfolio_value: number
  top_contributors: { asset_name: string; loss_amount: number; loss_pct: number }[]
  suggestions: string[]
}

export interface NewsWithAsset extends NewsItem {
  linked_assets: {
    asset_id: string
    asset_name: string
    asset_symbol: string
    relevance: number
    event_type: string | null
  }[]
}

export interface IndicatorValues {
  ma5: number | null
  ma10: number | null
  ma20: number | null
  ma60: number | null
  macd_dif: number | null
  macd_dea: number | null
  macd_histogram: number | null
  boll_upper: number | null
  boll_middle: number | null
  boll_lower: number | null
  kdj_k: number | null
  kdj_d: number | null
  kdj_j: number | null
  rsi: number | null
}

export interface AIChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  type?: 'chat' | 'summary' | 'risk_explanation' | 'report'
}

export interface AIChatContext {
  portfolio_summary: PortfolioSummary
  risk_metrics: RiskSummary
  positions: PositionWithAsset[]
  latest_news: NewsWithAsset[]
}

export interface AppSettings {
  theme: 'light' | 'dark'
  language: 'zh-CN'
  data_refresh_interval_ms: number
  /** @deprecated 请使用 ai_provider_configs 表 + ai_provider_id 设置 */
  ai_provider: string
  /** @deprecated 请使用 ai_provider_configs 表 */
  ai_model: string
  notifications_enabled: boolean
  sound_enabled: boolean
}

// ---- New types for P0/P1 fixes ----

export interface Account {
  id: string
  name: string
  broker: string | null
  currency: string
  description: string | null
  is_default: boolean
  created_at: string
  updated_at: string
}

export interface DataSourceConfig {
  id: string
  source_type: 'market' | 'news' | 'ai'
  provider: string
  name: string
  base_url: string | null
  api_key_encrypted: string | null
  is_enabled: boolean
  last_health_at: string | null
  last_health_status: 'ok' | 'error' | null
  last_error_message: string | null
  config_json: string | null
  created_at: string
  updated_at: string
}

export interface AIProviderConfigSafe {
  id: string
  provider: string
  name: string
  base_url: string | null
  model: string
  api_key_masked: string | null
  is_enabled: boolean
  last_health_at: string | null
  last_health_status: 'ok' | 'error' | null
}

export interface AssetIdentifier {
  symbol: string
  market: Market
  name?: string
  asset_type?: AssetType
  currency?: string
}

export interface ImportPreviewResult {
  headers: string[]
  detected_mapping: Record<string, string>
  rows: ImportRowError[]
  total_rows: number
  valid_rows: number
  error_rows: number
}

export interface ImportCommitResult {
  job_id: string
  imported: number
  skipped: number
  errors: ImportRowError[]
  positions_updated: number
}

export interface ImportRowError {
  row_index: number
  raw_data: Record<string, string>
  errors: string[]
}

export interface MarketProviderStatus {
  provider: string
  name: string
  is_enabled: boolean
  last_health_at: string | null
  last_health_status: 'ok' | 'error' | null
  last_error_message: string | null
}

export interface MarketProvider {
  id: string
  provider: string
  name: string
  getQuotes(symbols: AssetIdentifier[]): Promise<MarketQuote[]>
  getKline(symbol: AssetIdentifier, period: KlinePeriod, from?: string, to?: string): Promise<KlineBar[]>
  healthCheck(): Promise<boolean>
  normalizeAssetCode(symbol: string, market: string): string
}

// ============================================================
// Phase-1 Unified Asset Master Data Layer
// ============================================================

/** Normalized instrument — the canonical representation of a tradeable asset. */
export interface Instrument {
  id: string
  symbol: string
  market: Market
  name: string
  asset_type: AssetType
  currency: string
  industry: string | null
  style: string | null
  exchange: string | null
  aliases: string[] | null // 拼音、简称、英文名等
  is_active: boolean
  source: string // 数据录入来源
  source_time: string | null
  created_at: string
  updated_at: string
}

/** Market-facing listing record (what users search & browse). */
export interface InstrumentListing {
  symbol: string
  market: Market
  name: string
  asset_type: AssetType
  industry: string | null
  aliases: string[] | null
  is_active: boolean
  last_quote_price: number | null
  last_quote_change_pct: number | null
  last_quote_time: string | null
  updated_at: string
}

/** A single point-in-time snapshot of an instrument from a specific source. */
export interface InstrumentSnapshot {
  symbol: string
  market: Market
  asset_type: AssetType
  price: number | null
  change_pct: number | null
  volume: number | null
  turnover: number | null
  source: string
  provider_symbol: string | null // 供应商原始代码
  source_time: string
  staleness_ms: number
  confidence: 'high' | 'medium' | 'low'
}

/** Quote envelope — wraps a MarketQuote with provenance & quality metadata. */
export interface QuoteEnvelope {
  quote: MarketQuote
  provider: string
  provider_symbol: string
  requested: AssetIdentifier
  source_time: string
  confidence: 'high' | 'medium' | 'low'
}

/** Data quality tag attached to any fetched datum. */
export interface DataQualityStatus {
  source: string
  source_time: string
  staleness_ms: number
  confidence: 'high' | 'medium' | 'low'
  error_message: string | null
}

// ============================================================
// Fund-specific types
// ============================================================

export interface FundProfile {
  symbol: string
  market: Market
  name: string
  fund_type: string // 混合型-偏股、债券型、指数型 等
  manager: string | null
  management_company: string | null
  inception_date: string | null
  aum: number | null // 规模（亿元）
  expense_ratio: number | null // 管理费率
  purchase_status: 'open' | 'closed' | 'suspend' | null
  redemption_status: 'open' | 'closed' | 'suspend' | null
  benchmark: string | null
  tracking_index: string | null // ETF/指数型
  updated_at: string
}

export interface FundNav {
  symbol: string
  market: Market
  nav: number // 单位净值
  accumulated_nav: number | null // 累计净值
  daily_return_pct: number | null // 日增长率
  source: string
  nav_date: string
}

export interface FundHolding {
  symbol: string
  market: Market
  holding_symbol: string
  holding_name: string
  holding_type: 'stock' | 'bond' | 'cash' | 'other'
  weight_pct: number
  report_date: string
}

export interface FundPerformance {
  symbol: string
  market: Market
  period: '1m' | '3m' | '6m' | '1y' | '3y' | '5y' | 'ytd'
  return_pct: number
  rank_pct: number | null // 同类排名百分位，越小越好
  source: string
  updated_at: string
}

// ============================================================
// Risk model upgrade
// ============================================================

export interface RiskScoreBreakdown {
  risk_score: number // 0=低风险, 100=高风险
  health_score: number // 0=不健康, 100=非常健康（展示用）
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  volatility: number // 年化波动率（小数，如 0.15 = 15%）
  max_drawdown: number // 最大回撤（小数）
  sharpe_ratio: number | null
  beta: number | null
  var_95: number | null // 绝对金额
  cvar_95: number | null // CVaR 绝对金额
  concentration_score: number // 0-100
  correlation_score: number // 0-100
  liquidity_score: number // 0-100
  sentiment_score: number // 0-100
  sector_exposure: ExposureItem[]
  style_exposure: ExposureItem[]
  market_exposure: ExposureItem[]
  currency_exposure: ExposureItem[] | null
  calculated_at: string
}

// ============================================================
// AI structured outputs
// ============================================================

export interface AIAnswerSchema {
  summary: string
  facts: { label: string; value: string; source?: string }[]
  analysis: string
  risks: { level: 'low' | 'medium' | 'high'; description: string }[]
  watchlist: string[]
  suggestions: string[]
  sources: { name: string; url?: string; fetched_at: string }[]
  limitations: string[]
  disclaimer: string
}

// ============================================================
// Watchlist
// ============================================================

export interface WatchlistItem {
  id: string
  asset_id: string
  origin: 'manual' | 'trade'
  is_visible: boolean
  sort_order: number
  notes: string | null
  created_at: string
  updated_at: string
  last_tracked_at: string | null
}

export interface WatchlistItemWithStatus {
  id: string
  asset_id: string
  symbol: string
  market: Market
  name: string
  asset_type: AssetType
  origin: 'manual' | 'trade'
  is_visible: boolean
  has_position: boolean // derived from positions.quantity > 0
  quantity: number
  notes: string | null
  quote: MarketQuote | null
  quote_quality: DataQualityStatus | null
  last_tracked_at: string | null
  created_at: string
}
