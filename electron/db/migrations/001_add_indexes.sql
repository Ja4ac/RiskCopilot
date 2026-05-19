-- Migration 001: Add performance indexes
-- Applied by migrations/index.ts

CREATE INDEX IF NOT EXISTS idx_assets_symbol ON assets(symbol);
CREATE INDEX IF NOT EXISTS idx_assets_market ON assets(market);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type);

CREATE INDEX IF NOT EXISTS idx_trades_asset_id ON trades(asset_id);
CREATE INDEX IF NOT EXISTS idx_trades_trade_time ON trades(trade_time);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);

CREATE INDEX IF NOT EXISTS idx_positions_asset_id ON positions(asset_id);

CREATE INDEX IF NOT EXISTS idx_market_quotes_asset_time ON market_quotes(asset_id, quote_time);

CREATE INDEX IF NOT EXISTS idx_kline_bars_asset_period_time ON kline_bars(asset_id, period, bar_time);

CREATE INDEX IF NOT EXISTS idx_risk_snapshots_calculated_at ON risk_snapshots(calculated_at);

CREATE INDEX IF NOT EXISTS idx_news_items_importance ON news_items(importance);

CREATE INDEX IF NOT EXISTS idx_news_asset_links_news_id ON news_asset_links(news_id);
CREATE INDEX IF NOT EXISTS idx_news_asset_links_asset_id ON news_asset_links(asset_id);

CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_target ON alerts(target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(report_type);
