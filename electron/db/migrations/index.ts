import Database from 'better-sqlite3'

interface Migration {
  name: string
  sql: string
}

const MIGRATIONS: Migration[] = [
  {
    name: '001_initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        market TEXT NOT NULL,
        name TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'CNY',
        industry TEXT,
        style TEXT,
        exchange TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS trades (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        account_id TEXT NOT NULL DEFAULT 'default',
        side TEXT NOT NULL CHECK(side IN ('buy','sell')),
        quantity REAL NOT NULL CHECK(quantity > 0),
        price REAL NOT NULL CHECK(price > 0),
        fee REAL DEFAULT 0,
        tax REAL DEFAULT 0,
        trade_time TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','voided')),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (asset_id) REFERENCES assets(id)
      );

      CREATE TABLE IF NOT EXISTS positions (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        account_id TEXT NOT NULL DEFAULT 'default',
        quantity REAL NOT NULL DEFAULT 0,
        avg_cost REAL NOT NULL DEFAULT 0,
        cost_amount REAL NOT NULL DEFAULT 0,
        market_value REAL DEFAULT 0,
        unrealized_pnl REAL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (asset_id) REFERENCES assets(id),
        UNIQUE(asset_id, account_id)
      );

      CREATE TABLE IF NOT EXISTS market_quotes (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        price REAL NOT NULL,
        change_pct REAL,
        volume REAL,
        turnover REAL,
        quote_time TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'simulated',
        FOREIGN KEY (asset_id) REFERENCES assets(id)
      );

      CREATE TABLE IF NOT EXISTS kline_bars (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        period TEXT NOT NULL DEFAULT '1d',
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL,
        bar_time TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'simulated',
        FOREIGN KEY (asset_id) REFERENCES assets(id)
      );

      CREATE TABLE IF NOT EXISTS risk_snapshots (
        id TEXT PRIMARY KEY,
        portfolio_id TEXT NOT NULL DEFAULT 'default',
        risk_score REAL NOT NULL,
        volatility REAL,
        max_drawdown REAL,
        sharpe_ratio REAL,
        beta REAL,
        var_95 REAL,
        concentration_score REAL,
        correlation_score REAL,
        liquidity_score REAL,
        sentiment_score REAL,
        calculated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS news_items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT,
        source TEXT NOT NULL,
        url TEXT,
        published_at TEXT NOT NULL,
        sentiment REAL,
        importance TEXT NOT NULL DEFAULT 'low' CHECK(importance IN ('high','medium','low')),
        raw_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS news_asset_links (
        id TEXT PRIMARY KEY,
        news_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        relevance REAL NOT NULL,
        event_type TEXT,
        FOREIGN KEY (news_id) REFERENCES news_items(id),
        FOREIGN KEY (asset_id) REFERENCES assets(id)
      );

      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        alert_type TEXT NOT NULL,
        target_type TEXT NOT NULL DEFAULT 'asset',
        target_id TEXT NOT NULL,
        rule_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','triggered','acknowledged','resolved','archived')),
        triggered_at TEXT,
        acknowledged_at TEXT,
        resolved_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        report_type TEXT NOT NULL,
        title TEXT NOT NULL,
        content_markdown TEXT NOT NULL,
        source_context_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS corporate_actions (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        action_type TEXT NOT NULL CHECK(action_type IN ('split','dividend','bonus','rights_issue')),
        ex_date TEXT NOT NULL,
        value REAL NOT NULL,
        note TEXT,
        FOREIGN KEY (asset_id) REFERENCES assets(id)
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_trades_asset ON trades(asset_id);
      CREATE INDEX IF NOT EXISTS idx_trades_time ON trades(trade_time);
      CREATE INDEX IF NOT EXISTS idx_positions_asset ON positions(asset_id);
      CREATE INDEX IF NOT EXISTS idx_quotes_asset ON market_quotes(asset_id);
      CREATE INDEX IF NOT EXISTS idx_kline_asset_period ON kline_bars(asset_id, period);
      CREATE INDEX IF NOT EXISTS idx_kline_time ON kline_bars(bar_time);
      CREATE INDEX IF NOT EXISTS idx_news_importance ON news_items(importance);
      CREATE INDEX IF NOT EXISTS idx_news_published ON news_items(published_at);
      CREATE INDEX IF NOT EXISTS idx_news_links_news ON news_asset_links(news_id);
      CREATE INDEX IF NOT EXISTS idx_news_links_asset ON news_asset_links(asset_id);
      CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
      CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(report_type);
    `,
  },
  {
    name: '002_performance_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_assets_symbol ON assets(symbol);
      CREATE INDEX IF NOT EXISTS idx_assets_market ON assets(market);
      CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type);
      CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
      CREATE INDEX IF NOT EXISTS idx_market_quotes_asset_time ON market_quotes(asset_id, quote_time);
      CREATE INDEX IF NOT EXISTS idx_kline_bars_asset_period_time ON kline_bars(asset_id, period, bar_time);
      CREATE INDEX IF NOT EXISTS idx_risk_snapshots_calculated_at ON risk_snapshots(calculated_at);
      CREATE INDEX IF NOT EXISTS idx_news_asset_links_news_id ON news_asset_links(news_id);
      CREATE INDEX IF NOT EXISTS idx_news_asset_links_asset_id ON news_asset_links(asset_id);
      CREATE INDEX IF NOT EXISTS idx_alerts_target ON alerts(target_type, target_id);
    `,
  },
  {
    name: '004_stock_listings',
    sql: `
      CREATE TABLE IF NOT EXISTS stock_listings (
        symbol TEXT NOT NULL,
        market TEXT NOT NULL,
        name TEXT NOT NULL,
        asset_type TEXT NOT NULL CHECK(asset_type IN ('stock','etf','fund')),
        industry TEXT,
        list_date TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        last_quote_price REAL,
        last_quote_change_pct REAL,
        last_quote_time TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        PRIMARY KEY (symbol, market)
      );

      CREATE INDEX IF NOT EXISTS idx_listings_type ON stock_listings(asset_type);
      CREATE INDEX IF NOT EXISTS idx_listings_name ON stock_listings(name);
      CREATE INDEX IF NOT EXISTS idx_listings_industry ON stock_listings(industry);
      CREATE INDEX IF NOT EXISTS idx_listings_active ON stock_listings(is_active);
    `,
  },
  {
    name: '005_stock_listings_performance',
    sql: `
      ALTER TABLE stock_listings ADD COLUMN change_1w_pct REAL;
      ALTER TABLE stock_listings ADD COLUMN change_1m_pct REAL;
      ALTER TABLE stock_listings ADD COLUMN change_3m_pct REAL;
      ALTER TABLE stock_listings ADD COLUMN change_6m_pct REAL;
      ALTER TABLE stock_listings ADD COLUMN change_1y_pct REAL;
    `,
  },
  {
    name: '003_accounts_and_data_sources',
    sql: `
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        broker TEXT,
        currency TEXT NOT NULL DEFAULT 'CNY',
        description TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      INSERT OR IGNORE INTO accounts (id, name, broker, currency, description, is_default)
      VALUES ('default', '默认账户', NULL, 'CNY', '系统默认账户', 1);

      CREATE TABLE IF NOT EXISTS data_sources (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL CHECK(source_type IN ('market','news','ai')),
        provider TEXT NOT NULL,
        name TEXT NOT NULL,
        base_url TEXT,
        api_key_encrypted TEXT,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        last_health_at TEXT,
        last_health_status TEXT CHECK(last_health_status IN ('ok','error')),
        last_error_message TEXT,
        config_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS import_jobs (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_type TEXT NOT NULL DEFAULT 'csv',
        total_rows INTEGER NOT NULL DEFAULT 0,
        imported_rows INTEGER NOT NULL DEFAULT 0,
        skipped_rows INTEGER NOT NULL DEFAULT 0,
        error_rows INTEGER NOT NULL DEFAULT 0,
        field_mapping_json TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),
        error_summary TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (account_id) REFERENCES accounts(id)
      );

      CREATE TABLE IF NOT EXISTS import_errors (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        row_index INTEGER NOT NULL,
        raw_data_json TEXT,
        error_messages_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (job_id) REFERENCES import_jobs(id)
      );

      CREATE TABLE IF NOT EXISTS ai_provider_configs (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        name TEXT NOT NULL,
        base_url TEXT,
        api_key_encrypted TEXT,
        model TEXT NOT NULL DEFAULT '',
        is_enabled INTEGER NOT NULL DEFAULT 1,
        last_health_at TEXT,
        last_health_status TEXT CHECK(last_health_status IN ('ok','error')),
        last_error_message TEXT,
        config_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      INSERT OR IGNORE INTO data_sources (id, source_type, provider, name, base_url, is_enabled)
      VALUES ('mock-default', 'market', 'mock', '本地模拟行情', NULL, 1);

      INSERT OR IGNORE INTO ai_provider_configs (id, provider, name, base_url, api_key_encrypted, model, is_enabled)
      VALUES ('mock-default', 'mock', '本地模拟', NULL, NULL, 'mock-model', 1);

      CREATE INDEX IF NOT EXISTS idx_data_sources_type ON data_sources(source_type);
      CREATE INDEX IF NOT EXISTS idx_import_jobs_account ON import_jobs(account_id);
      CREATE INDEX IF NOT EXISTS idx_import_errors_job ON import_errors(job_id);
      CREATE INDEX IF NOT EXISTS idx_ai_provider_enabled ON ai_provider_configs(is_enabled);
    `,
  },
  {
    name: '006_fund_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS fund_profiles (
        symbol TEXT NOT NULL,
        market TEXT NOT NULL,
        name TEXT NOT NULL,
        fund_type TEXT,
        manager TEXT,
        management_company TEXT,
        inception_date TEXT,
        aum REAL,
        expense_ratio REAL,
        purchase_status TEXT,
        redemption_status TEXT,
        benchmark TEXT,
        tracking_index TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (symbol, market)
      );

      CREATE TABLE IF NOT EXISTS fund_navs (
        symbol TEXT NOT NULL,
        market TEXT NOT NULL,
        nav REAL NOT NULL,
        accumulated_nav REAL,
        daily_return_pct REAL,
        source TEXT NOT NULL,
        nav_date TEXT NOT NULL,
        PRIMARY KEY (symbol, market, nav_date)
      );

      CREATE TABLE IF NOT EXISTS fund_holdings (
        symbol TEXT NOT NULL,
        market TEXT NOT NULL,
        holding_symbol TEXT NOT NULL,
        holding_name TEXT NOT NULL,
        holding_type TEXT NOT NULL,
        weight_pct REAL NOT NULL,
        report_date TEXT NOT NULL,
        PRIMARY KEY (symbol, market, holding_symbol, report_date)
      );

      CREATE TABLE IF NOT EXISTS fund_performances (
        symbol TEXT NOT NULL,
        market TEXT NOT NULL,
        period TEXT NOT NULL,
        return_pct REAL NOT NULL,
        rank_pct REAL,
        source TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (symbol, market, period)
      );

      CREATE INDEX IF NOT EXISTS idx_fund_navs_symbol ON fund_navs(symbol, market);
      CREATE INDEX IF NOT EXISTS idx_fund_holdings_symbol ON fund_holdings(symbol, market);
    `,
  },
  {
    name: '007_watchlist_items',
    sql: `
      CREATE TABLE IF NOT EXISTS watchlist_items (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        origin TEXT NOT NULL DEFAULT 'manual' CHECK(origin IN ('manual', 'trade')),
        is_visible INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        last_tracked_at TEXT,
        FOREIGN KEY (asset_id) REFERENCES assets(id),
        UNIQUE(asset_id)
      );

      CREATE INDEX IF NOT EXISTS idx_watchlist_asset ON watchlist_items(asset_id);
      CREATE INDEX IF NOT EXISTS idx_watchlist_visible ON watchlist_items(is_visible);
    `,
  },
  {
    name: '008_remove_simulated_quotes',
    sql: `
      -- Remove all simulated quotes and klines to stop displaying fake data
      DELETE FROM market_quotes WHERE source = 'simulated';
      DELETE FROM kline_bars WHERE source = 'simulated';
    `,
  },
  {
    name: '009_clear_all_demo_data',
    sql: `
      -- Clear all demo/seeded portfolio data to ensure zero simulated data remains.
      -- This removes positions, trades, and related computed data.
      -- Assets and stock_listings are preserved as search caches.
      DELETE FROM positions;
      DELETE FROM trades;
      DELETE FROM market_quotes;
      DELETE FROM kline_bars;
      DELETE FROM news_asset_links;
      DELETE FROM news_items;
      DELETE FROM alerts;
      DELETE FROM risk_snapshots;
    `,
  },
  {
    name: '010_portfolio_history',
    sql: `
      CREATE TABLE IF NOT EXISTS portfolio_daily_value (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        total_market_value REAL NOT NULL DEFAULT 0,
        total_cost REAL NOT NULL DEFAULT 0,
        total_pnl REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_daily_date ON portfolio_daily_value(date);
      CREATE INDEX IF NOT EXISTS idx_portfolio_daily_created ON portfolio_daily_value(created_at);
    `,
  },
]

/**
 * Run all pending migrations in order inside a transaction.
 * Tracks applied migrations in the `_migrations` table.
 */
export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `)

  const applied = db
    .prepare('SELECT name FROM _migrations')
    .all() as { name: string }[]
  const appliedSet = new Set(applied.map((r) => r.name))

  for (const migration of MIGRATIONS) {
    if (appliedSet.has(migration.name)) continue

    const apply = db.transaction(() => {
      db.exec(migration.sql)
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(migration.name)
    })

    apply()
    console.log(`[Migration] Applied: ${migration.name}`)
  }
}
