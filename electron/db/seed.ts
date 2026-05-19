import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

// ============================================================
// Seeded PRNG (mulberry32) — reproducible outputs
// ============================================================
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(42)
function randRange(min: number, max: number): number { return min + rand() * (max - min) }
function randInt(min: number, max: number): number { return Math.floor(randRange(min, max + 1)) }

function gaussianRandom(): number {
  let u = 0, v = 0
  while (u === 0) u = rand()
  while (v === 0) v = rand()
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

// ============================================================
// Date helpers
// ============================================================
function isoDateTime(daysAgo: number, hour: number, minute = 0): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

function isoDateOnly(daysAgo: number): string {
  return isoDateTime(daysAgo, 0).split('T')[0]
}

function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0 }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

// ============================================================
// Asset definitions — 12 assets with realistic prices
// ============================================================
interface AssetSeed {
  symbol: string; market: string; name: string; asset_type: string
  currency: string; industry: string | null; style: string | null; exchange: string | null
  seedPrice: number; lotSize: number
}

const ASSETS: AssetSeed[] = [
  { symbol: '300750', market: 'SZ', name: '宁德时代', asset_type: 'stock', currency: 'CNY', industry: '新能源', style: '成长', exchange: '深圳证券交易所', seedPrice: 205, lotSize: 100 },
  { symbol: '600519', market: 'SH', name: '贵州茅台', asset_type: 'stock', currency: 'CNY', industry: '白酒', style: '价值', exchange: '上海证券交易所', seedPrice: 1620, lotSize: 100 },
  { symbol: '00700', market: 'HK', name: '腾讯控股', asset_type: 'stock', currency: 'HKD', industry: '互联网', style: '成长', exchange: '香港交易所', seedPrice: 385, lotSize: 100 },
  { symbol: '002594', market: 'SZ', name: '比亚迪', asset_type: 'stock', currency: 'CNY', industry: '新能源车', style: '成长', exchange: '深圳证券交易所', seedPrice: 268, lotSize: 100 },
  { symbol: '600036', market: 'SH', name: '招商银行', asset_type: 'stock', currency: 'CNY', industry: '银行', style: '价值', exchange: '上海证券交易所', seedPrice: 38.5, lotSize: 100 },
  { symbol: '300274', market: 'SZ', name: '阳光电源', asset_type: 'stock', currency: 'CNY', industry: '光伏', style: '成长', exchange: '深圳证券交易所', seedPrice: 82, lotSize: 100 },
  { symbol: '510300', market: 'SH', name: '沪深300ETF', asset_type: 'etf', currency: 'CNY', industry: '宽基', style: null, exchange: '上海证券交易所', seedPrice: 3.95, lotSize: 100 },
  { symbol: '510500', market: 'SH', name: '中证500ETF', asset_type: 'etf', currency: 'CNY', industry: '中盘', style: null, exchange: '上海证券交易所', seedPrice: 6.15, lotSize: 100 },
  { symbol: '513180', market: 'SH', name: '恒生科技ETF', asset_type: 'etf', currency: 'CNY', industry: '科技', style: null, exchange: '上海证券交易所', seedPrice: 0.52, lotSize: 100 },
  { symbol: '005827', market: 'SH', name: '易方达蓝筹精选', asset_type: 'fund', currency: 'CNY', industry: '混合', style: null, exchange: null, seedPrice: 2.08, lotSize: 1 },
  { symbol: '003095', market: 'SH', name: '中欧医疗健康', asset_type: 'fund', currency: 'CNY', industry: '医疗', style: null, exchange: null, seedPrice: 1.55, lotSize: 1 },
  { symbol: '000961', market: 'SH', name: '天弘沪深300', asset_type: 'fund', currency: 'CNY', industry: '指数', style: null, exchange: null, seedPrice: 1.18, lotSize: 1 },
]

// ============================================================
// Trade plans — 30+ trades over 6 months
// ============================================================
type TradePlan = { side: 'buy' | 'sell'; qty: number; priceMult: number; dayOffset: number }

const TRADE_PLANS: Record<string, TradePlan[]> = {
  '300750': [
    { side: 'buy', qty: 500, priceMult: 0.95, dayOffset: 0 },
    { side: 'buy', qty: 300, priceMult: 1.05, dayOffset: 45 },
    { side: 'sell', qty: 200, priceMult: 1.12, dayOffset: 90 },
    { side: 'buy', qty: 200, priceMult: 1.08, dayOffset: 120 },
    { side: 'sell', qty: 100, priceMult: 1.18, dayOffset: 150 },
  ],
  '600519': [
    { side: 'buy', qty: 100, priceMult: 0.97, dayOffset: 5 },
    { side: 'buy', qty: 50, priceMult: 0.99, dayOffset: 60 },
    { side: 'sell', qty: 20, priceMult: 1.05, dayOffset: 100 },
    { side: 'buy', qty: 30, priceMult: 1.02, dayOffset: 130 },
  ],
  '00700': [
    { side: 'buy', qty: 300, priceMult: 0.96, dayOffset: 10 },
    { side: 'sell', qty: 100, priceMult: 1.08, dayOffset: 70 },
    { side: 'buy', qty: 100, priceMult: 1.03, dayOffset: 110 },
    { side: 'sell', qty: 50, priceMult: 1.10, dayOffset: 155 },
  ],
  '002594': [
    { side: 'buy', qty: 400, priceMult: 0.96, dayOffset: 8 },
    { side: 'buy', qty: 200, priceMult: 1.04, dayOffset: 50 },
    { side: 'sell', qty: 150, priceMult: 1.10, dayOffset: 95 },
    { side: 'buy', qty: 100, priceMult: 1.06, dayOffset: 125 },
  ],
  '600036': [
    { side: 'buy', qty: 2000, priceMult: 0.95, dayOffset: 3 },
    { side: 'buy', qty: 1000, priceMult: 1.05, dayOffset: 55 },
    { side: 'sell', qty: 500, priceMult: 1.12, dayOffset: 105 },
    { side: 'buy', qty: 1500, priceMult: 1.08, dayOffset: 140 },
  ],
  '300274': [
    { side: 'buy', qty: 800, priceMult: 0.95, dayOffset: 12 },
    { side: 'buy', qty: 400, priceMult: 1.05, dayOffset: 65 },
    { side: 'sell', qty: 300, priceMult: 1.02, dayOffset: 115 },
    { side: 'buy', qty: 200, priceMult: 0.92, dayOffset: 145 },
  ],
  '510300': [
    { side: 'buy', qty: 10000, priceMult: 0.97, dayOffset: 15 },
    { side: 'buy', qty: 5000, priceMult: 1.03, dayOffset: 80 },
    { side: 'sell', qty: 3000, priceMult: 1.08, dayOffset: 135 },
  ],
  '510500': [
    { side: 'buy', qty: 8000, priceMult: 0.95, dayOffset: 20 },
    { side: 'buy', qty: 3000, priceMult: 1.04, dayOffset: 85 },
  ],
  '513180': [
    { side: 'buy', qty: 50000, priceMult: 0.92, dayOffset: 25 },
    { side: 'buy', qty: 20000, priceMult: 1.05, dayOffset: 90 },
    { side: 'sell', qty: 10000, priceMult: 1.12, dayOffset: 145 },
  ],
  '005827': [
    { side: 'buy', qty: 20000, priceMult: 0.96, dayOffset: 18 },
    { side: 'buy', qty: 10000, priceMult: 1.04, dayOffset: 75 },
  ],
  '003095': [
    { side: 'buy', qty: 15000, priceMult: 1.00, dayOffset: 22 },
    { side: 'buy', qty: 8000, priceMult: 0.94, dayOffset: 82 },
  ],
  '000961': [
    { side: 'buy', qty: 30000, priceMult: 0.96, dayOffset: 28 },
    { side: 'buy', qty: 15000, priceMult: 1.04, dayOffset: 95 },
  ],
}

// ============================================================
// News definitions — 24 realistic Chinese market news items
// ============================================================
interface NewsSeed {
  title: string; summary: string; source: string
  published_at: string; sentiment: number; importance: string
  linkedSymbols: string[]; relevanceScores: number[]; eventTypes: (string | null)[]
}

const NEWS_SEEDS: NewsSeed[] = [
  {
    title: '新能源汽车补贴政策调整，行业竞争格局或生变',
    summary: '工信部发布新能源汽车补贴新政，提高技术门槛，补贴金额整体退坡20%。行业分析人士认为龙头企业将受益于集中度提升。',
    source: '财联社', published_at: '2026-05-10T09:30:00.000Z',
    sentiment: 0.3, importance: 'high',
    linkedSymbols: ['300750', '002594'], relevanceScores: [0.92, 0.95],
    eventTypes: ['policy_change', 'policy_change'],
  },
  {
    title: '腾讯控股发布季度财报，营收超预期',
    summary: '腾讯控股公布一季度财报，营收1850亿元，同比增长12%，游戏和广告业务表现强劲。',
    source: '新浪财经', published_at: '2026-05-08T16:00:00.000Z',
    sentiment: 0.65, importance: 'high',
    linkedSymbols: ['00700', '513180'], relevanceScores: [0.98, 0.75],
    eventTypes: ['earnings', null],
  },
  {
    title: '贵州茅台宣布特别分红方案',
    summary: '贵州茅台公告2025年度利润分配方案，拟每10股派发现金红利259.11元，分红比例达51.9%。',
    source: '证券时报', published_at: '2026-05-05T08:00:00.000Z',
    sentiment: 0.55, importance: 'medium',
    linkedSymbols: ['600519'], relevanceScores: [1.0],
    eventTypes: ['dividend'],
  },
  {
    title: '光伏产业链价格企稳，下游需求回暖',
    summary: '硅料价格连续三周企稳，组件环节开工率提升至75%以上，机构预计下半年光伏装机将加速。',
    source: 'PVInfoLink', published_at: '2026-05-03T10:00:00.000Z',
    sentiment: 0.4, importance: 'medium',
    linkedSymbols: ['300274'], relevanceScores: [0.9],
    eventTypes: ['industry_trend'],
  },
  {
    title: '银行板块集体走强，招商银行领涨',
    summary: '受降准预期和业绩改善推动，银行板块今日集体上涨。招商银行涨超3%，创年内新高。',
    source: '东方财富', published_at: '2026-04-28T15:30:00.000Z',
    sentiment: 0.6, importance: 'medium',
    linkedSymbols: ['600036'], relevanceScores: [0.95],
    eventTypes: ['price_movement'],
  },
  {
    title: '宁德时代发布新一代钠离子电池技术',
    summary: '宁德时代宣布第二代钠离子电池能量密度达到200Wh/kg，成本较锂电池降低30%，预计2027年量产。',
    source: '36氪', published_at: '2026-04-25T09:00:00.000Z',
    sentiment: 0.7, importance: 'high',
    linkedSymbols: ['300750'], relevanceScores: [0.98],
    eventTypes: ['product_launch'],
  },
  {
    title: '中欧医疗健康基金经理展望：创新药迎来黄金时代',
    summary: '基金经理葛兰表示，创新药审批加速、医保谈判机制优化，医疗健康板块长期投资价值凸显。',
    source: '天天基金', published_at: '2026-04-20T14:00:00.000Z',
    sentiment: 0.5, importance: 'medium',
    linkedSymbols: ['003095'], relevanceScores: [1.0],
    eventTypes: ['fund_manager_view'],
  },
  {
    title: '比亚迪海外销量突破50万辆',
    summary: '比亚迪2026年前四个月海外销量累计突破50万辆，同比增长85%，东南亚和欧洲市场表现亮眼。',
    source: '汽车之家', published_at: '2026-04-18T10:00:00.000Z',
    sentiment: 0.7, importance: 'high',
    linkedSymbols: ['002594', '300750'], relevanceScores: [0.95, 0.6],
    eventTypes: ['sales_data', null],
  },
  {
    title: 'A股市场震荡调整，沪深300ETF获大额净申购',
    summary: '市场回调期间，沪深300ETF单日净申购超50亿元，显示资金逢低布局意愿强烈。',
    source: '中国证券报', published_at: '2026-04-15T16:00:00.000Z',
    sentiment: 0.2, importance: 'medium',
    linkedSymbols: ['510300', '000961'], relevanceScores: [0.95, 0.88],
    eventTypes: ['capital_flow', 'capital_flow'],
  },
  {
    title: '恒生科技指数反弹，互联网平台监管趋缓',
    summary: '市场预期互联网平台监管政策将进一步优化，恒生科技指数单日涨幅超3%。',
    source: '华尔街见闻', published_at: '2026-04-12T09:00:00.000Z',
    sentiment: 0.55, importance: 'medium',
    linkedSymbols: ['513180', '00700'], relevanceScores: [0.92, 0.85],
    eventTypes: ['policy_change', 'policy_change'],
  },
  {
    title: '招商银行年报：零售AUM突破15万亿',
    summary: '招商银行2025年年报显示零售客户总资产突破15万亿元，财富管理手续费收入增长18%。',
    source: '21世纪经济报道', published_at: '2026-04-08T08:00:00.000Z',
    sentiment: 0.5, importance: 'medium',
    linkedSymbols: ['600036'], relevanceScores: [0.98],
    eventTypes: ['earnings'],
  },
  {
    title: '阳光电源中标沙特大型储能项目',
    summary: '阳光电源中标沙特NEOM新城2GWh储能项目，合同金额约15亿美元，创公司海外单体订单纪录。',
    source: '光伏资讯', published_at: '2026-04-05T11:00:00.000Z',
    sentiment: 0.75, importance: 'high',
    linkedSymbols: ['300274'], relevanceScores: [0.98],
    eventTypes: ['contract_win'],
  },
  {
    title: '中证500指数增强策略表现优异',
    summary: '今年以来中证500增强基金平均超额收益达3.2%，中小盘风格持续占优。',
    source: '中国基金报', published_at: '2026-04-02T14:00:00.000Z',
    sentiment: 0.4, importance: 'low',
    linkedSymbols: ['510500'], relevanceScores: [0.9],
    eventTypes: ['performance_review'],
  },
  {
    title: '易方达蓝筹精选调仓：增持消费龙头',
    summary: '基金经理张坤在一季报中透露，增持了食品饮料和家电龙头，减持了部分港股互联网标的。',
    source: '证券日报', published_at: '2026-03-28T10:00:00.000Z',
    sentiment: 0.3, importance: 'medium',
    linkedSymbols: ['005827', '600519'], relevanceScores: [1.0, 0.7],
    eventTypes: ['portfolio_change', null],
  },
  {
    title: '沪深港通北向资金连续5日净流入',
    summary: '北向资金近期持续流入A股，近5个交易日累计净买入超200亿元，偏好新能源和消费板块。',
    source: 'Wind资讯', published_at: '2026-03-25T16:30:00.000Z',
    sentiment: 0.45, importance: 'medium',
    linkedSymbols: ['300750', '600519', '510300'], relevanceScores: [0.7, 0.7, 0.85],
    eventTypes: ['capital_flow', 'capital_flow', 'capital_flow'],
  },
  {
    title: '美国关税政策不确定性增加，港股承压',
    summary: '美国宣布对华新一轮关税审查，恒生指数盘中一度下跌2.5%，科技股跌幅居前。',
    source: '路透社', published_at: '2026-03-20T15:00:00.000Z',
    sentiment: -0.5, importance: 'high',
    linkedSymbols: ['00700', '513180'], relevanceScores: [0.9, 0.92],
    eventTypes: ['macro_event', 'macro_event'],
  },
  {
    title: '天弘沪深300基金规模突破800亿',
    summary: '受益于指数基金大发展，天弘沪深300指数基金最新规模突破800亿元，成为规模最大的场外沪深300指基。',
    source: '基金业协会', published_at: '2026-03-18T09:00:00.000Z',
    sentiment: 0.35, importance: 'low',
    linkedSymbols: ['000961', '510300'], relevanceScores: [0.98, 0.8],
    eventTypes: ['fund_size', null],
  },
  {
    title: '白酒行业春节动销超预期',
    summary: '2026年春节期间白酒动销同比增长15%，高端白酒需求依然旺盛，渠道库存降至合理水平。',
    source: '酒业家', published_at: '2026-03-10T10:00:00.000Z',
    sentiment: 0.6, importance: 'medium',
    linkedSymbols: ['600519'], relevanceScores: [0.95],
    eventTypes: ['sales_data'],
  },
  {
    title: '央行降准0.25个百分点，释放长期资金约5000亿',
    summary: '中国人民银行宣布下调金融机构存款准备金率0.25个百分点，旨在支持实体经济发展。',
    source: '央行官网', published_at: '2026-03-05T17:00:00.000Z',
    sentiment: 0.5, importance: 'high',
    linkedSymbols: ['600036', '510300', '000961'], relevanceScores: [0.8, 0.85, 0.8],
    eventTypes: ['macro_event', 'macro_event', 'macro_event'],
  },
  {
    title: '医疗集采政策边际缓和，板块估值修复',
    summary: '第七批国家药品集采平均降价48%，降幅较此前收窄，市场解读为政策边际改善。',
    source: '医药经济报', published_at: '2026-02-28T14:00:00.000Z',
    sentiment: 0.25, importance: 'medium',
    linkedSymbols: ['003095'], relevanceScores: [0.92],
    eventTypes: ['policy_change'],
  },
  {
    title: '中证500ETF期权上市，市场关注度提升',
    summary: '中证500ETF期权正式挂牌交易，有助于丰富风险管理工具，提升中小盘股的定价效率。',
    source: '上交所', published_at: '2026-02-20T09:30:00.000Z',
    sentiment: 0.45, importance: 'medium',
    linkedSymbols: ['510500'], relevanceScores: [0.95],
    eventTypes: ['product_launch'],
  },
  {
    title: '比亚迪发布新款高端车型仰望U9',
    summary: '比亚迪发布仰望U9超跑，售价52.8万元起，搭载最新e平台4.0和固态电池技术，剑指高端市场。',
    source: '懂车帝', published_at: '2026-02-15T10:00:00.000Z',
    sentiment: 0.55, importance: 'medium',
    linkedSymbols: ['002594', '300750'], relevanceScores: [0.95, 0.65],
    eventTypes: ['product_launch', null],
  },
  {
    title: 'A股成交额连续突破万亿',
    summary: '市场情绪明显回暖，沪深两市成交额连续5个交易日突破万亿，券商板块表现活跃。',
    source: '中国证券报', published_at: '2026-02-08T15:30:00.000Z',
    sentiment: 0.4, importance: 'medium',
    linkedSymbols: ['510300', '510500'], relevanceScores: [0.8, 0.75],
    eventTypes: ['market_sentiment', 'market_sentiment'],
  },
  {
    title: '全球央行增持黄金，避险情绪升温',
    summary: '2026年1月全球央行净购金量达45吨，国际金价突破2500美元/盎司，市场避险需求上升。',
    source: '世界黄金协会', published_at: '2026-01-25T11:00:00.000Z',
    sentiment: -0.3, importance: 'low',
    linkedSymbols: ['005827', '600036'], relevanceScores: [0.3, 0.4],
    eventTypes: ['macro_event', 'macro_event'],
  },
]

// ============================================================
// GBM price simulation for kline bars
// ============================================================
function generateKlineBars(
  seedPrice: number,
  days: number,
  assetType: string
): { open: number; high: number; low: number; close: number; volume: number; barTime: string }[] {
  const sigma = assetType === 'stock' ? 0.28 : assetType === 'etf' ? 0.22 : 0.15
  const mu = 0.08
  const dt = 1 / 252
  const driftTerm = (mu - 0.5 * sigma * sigma) * dt
  const diffusion = sigma * Math.sqrt(dt)

  // Generate closing prices backward from today (most recent = seedPrice)
  const closes: number[] = []
  let price = seedPrice
  for (let i = 0; i < days; i++) {
    const shock = gaussianRandom()
    price = price * Math.exp(driftTerm + diffusion * shock)
    price = Math.max(price, seedPrice * 0.4)
    closes.push(Math.round(price * 100) / 100)
  }

  // Build OHLC bars from oldest to newest
  const bars: { open: number; high: number; low: number; close: number; volume: number; barTime: string }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const dayOffset = i
    const close = closes[i]
    const prevClose = i < days - 1 ? closes[i + 1] : close
    const open = prevClose
    const wick = close * 0.015 * (1 + rand())
    const high = Math.max(open, close) + wick * rand()
    const low = Math.max(Math.min(open, close) - wick * rand(), 0.01)
    const volume = assetType === 'stock' ? randRange(3000000, 80000000)
      : assetType === 'etf' ? randRange(5000000, 150000000)
      : randRange(500000, 8000000)

    bars.push({
      open: Math.round(open * 100) / 100,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      close: Math.round(close * 100) / 100,
      volume: Math.round(volume),
      barTime: isoDateOnly(dayOffset),
    })
  }

  return bars
}

// ============================================================
// Main seed function
// ============================================================
export function seedDatabase(db: Database.Database): void {
  const assetCount = (db.prepare('SELECT COUNT(*) as c FROM assets').get() as { c: number }).c
  const posCount = (db.prepare('SELECT COUNT(*) as c FROM positions').get() as { c: number }).c

  if (assetCount > 0 && posCount > 0) {
    console.log('[Seed] Database already fully seeded, skipping.')
    return
  }

  // If assets exist but positions are missing, we have a partial/incomplete DB.
  // Clear existing data and reseed from scratch to ensure consistency.
  if (assetCount > 0 && posCount === 0) {
    console.log('[Seed] Database has assets but no positions — clearing and reseeding...')
    try { db.prepare("DELETE FROM alerts").run() } catch { /* ignore */ }
    try { db.prepare("DELETE FROM news_asset_links").run() } catch { /* ignore */ }
    try { db.prepare("DELETE FROM news_items").run() } catch { /* ignore */ }
    try { db.prepare("DELETE FROM risk_snapshots").run() } catch { /* ignore */ }
    try { db.prepare("DELETE FROM kline_bars").run() } catch { /* ignore */ }
    try { db.prepare("DELETE FROM market_quotes").run() } catch { /* ignore */ }
    try { db.prepare("DELETE FROM positions").run() } catch { /* ignore */ }
    try { db.prepare("DELETE FROM trades").run() } catch { /* ignore */ }
    try { db.prepare("DELETE FROM assets").run() } catch { /* ignore */ }
  }

  const seed = db.transaction(() => {
    // ---- 1. Assets ----
    const insertAsset = db.prepare(`
      INSERT INTO assets (id, symbol, market, name, asset_type, currency, industry, style, exchange, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))
    `)
    const assetIds: Record<string, string> = {}
    const assetInfos: Record<string, AssetSeed> = {}

    for (const a of ASSETS) {
      const id = uuidv4()
      assetIds[a.symbol] = id
      assetInfos[a.symbol] = a
      insertAsset.run(id, a.symbol, a.market, a.name, a.asset_type, a.currency, a.industry, a.style, a.exchange)
    }
    console.log(`[Seed]   Assets: ${ASSETS.length}`)

    // ---- 2. Trades ----
    const insertTrade = db.prepare(`
      INSERT INTO trades (id, asset_id, account_id, side, quantity, price, fee, tax, trade_time, source, status, created_at)
      VALUES (?, ?, 'default', ?, ?, ?, ?, ?, ?, 'manual', 'active', ?)
    `)
    let tradeCount = 0
    type TradeRecord = { asset_id: string; side: string; quantity: number; price: number; fee: number }

    for (const [symbol, plans] of Object.entries(TRADE_PLANS)) {
      const assetId = assetIds[symbol]
      const info = assetInfos[symbol]
      if (!assetId || !info) continue

      for (const plan of plans) {
        const price = Math.round(info.seedPrice * plan.priceMult * 100) / 100
        const amount = price * plan.qty
        const fee = Math.round(amount * 0.0003 * 100) / 100
        const tax = plan.side === 'sell' ? Math.round(amount * 0.001 * 100) / 100 : 0
        const tradeTime = isoDateTime(plan.dayOffset, randInt(9, 14), randInt(0, 59))
        const now = new Date().toISOString()

        insertTrade.run(uuidv4(), assetId, plan.side, plan.qty, price, fee, tax, tradeTime, now)
        tradeCount++
      }
    }
    console.log(`[Seed]   Trades: ${tradeCount}`)

    // ---- 3. Positions (aggregated from trades) ----
    const tradeRows = db.prepare(`
      SELECT asset_id, side, quantity, price, fee FROM trades WHERE status = 'active'
    `).all() as { asset_id: string; side: string; quantity: number; price: number; fee: number }[]

    const agg = new Map<string, { totalQty: number; totalCost: number }>()
    for (const t of tradeRows) {
      let e = agg.get(t.asset_id)
      if (!e) { e = { totalQty: 0, totalCost: 0 }; agg.set(t.asset_id, e) }
      if (t.side === 'buy') {
        e.totalQty += t.quantity
        e.totalCost += t.quantity * t.price + t.fee
      } else {
        const sellQty = Math.min(t.quantity, e.totalQty)
        if (e.totalQty > 0) {
          const avgC = e.totalCost / e.totalQty
          e.totalQty -= sellQty
          e.totalCost = e.totalQty * avgC
        }
      }
    }

    const insertPosition = db.prepare(`
      INSERT INTO positions (id, asset_id, account_id, quantity, avg_cost, cost_amount, market_value, unrealized_pnl, updated_at)
      VALUES (?, ?, 'default', ?, ?, ?, 0, 0, datetime('now','localtime'))
    `)
    let posCount = 0
    for (const [assetId, data] of agg) {
      if (data.totalQty <= 0) continue
      const avgCost = data.totalCost / data.totalQty
      insertPosition.run(uuidv4(), assetId, data.totalQty, avgCost, data.totalCost)
      posCount++
    }
    console.log(`[Seed]   Positions: ${posCount}`)

    // ---- 4. Positions market value update (no simulated klines/quotes) ----
    const updatePosition = db.prepare(`
      UPDATE positions SET market_value = ?, unrealized_pnl = ?, updated_at = datetime('now','localtime') WHERE id = ?
    `)
    const positionRows = db.prepare('SELECT * FROM positions WHERE quantity > 0').all() as {
      id: string; asset_id: string; quantity: number; cost_amount: number
    }[]

    // Build symbol lookup from assetId → symbol
    const assetIdToSymbol = new Map<string, string>()
    for (const [sym, id] of Object.entries(assetIds)) assetIdToSymbol.set(id, sym)

    for (const pos of positionRows) {
      const symbol = assetIdToSymbol.get(pos.asset_id)
      const info = symbol ? assetInfos[symbol] : undefined
      if (!info) continue

      // Use seedPrice as initial market value (will be overwritten by real quotes once synced)
      const marketValue = Math.round(pos.quantity * info.seedPrice * 100) / 100
      const unrealizedPnl = Math.round((marketValue - pos.cost_amount) * 100) / 100
      updatePosition.run(marketValue, unrealizedPnl, pos.id)
    }

    // ---- 5. News items + links ----
    const insertNews = db.prepare(`
      INSERT INTO news_items (id, title, summary, source, url, published_at, sentiment, importance, raw_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    `)
    const insertLink = db.prepare(`
      INSERT INTO news_asset_links (id, news_id, asset_id, relevance, event_type)
      VALUES (?, ?, ?, ?, ?)
    `)

    let linkCount = 0
    for (const n of NEWS_SEEDS) {
      const newsId = uuidv4()
      insertNews.run(newsId, n.title, n.summary, n.source, null, n.published_at, n.sentiment, n.importance, simpleHash(n.title + n.published_at))

      for (let i = 0; i < n.linkedSymbols.length; i++) {
        const linkedAssetId = assetIds[n.linkedSymbols[i]]
        if (!linkedAssetId) continue
        insertLink.run(uuidv4(), newsId, linkedAssetId, n.relevanceScores[i] ?? 0.5, n.eventTypes[i] ?? null)
        linkCount++
      }
    }
    console.log(`[Seed]   News: ${NEWS_SEEDS.length}, Links: ${linkCount}`)

    // ---- 6. Alerts ----
    const insertAlert = db.prepare(`
      INSERT INTO alerts (id, alert_type, target_type, target_id, rule_json, status, created_at, updated_at)
      VALUES (?, ?, 'asset', ?, ?, 'pending', datetime('now','localtime'), datetime('now','localtime'))
    `)

    // Alert 1: Concentration — 宁德时代 > 20%
    const ntdId = assetIds['300750']
    if (ntdId) {
      insertAlert.run(uuidv4(), 'concentration', ntdId, JSON.stringify({
        type: 'concentration', target_type: 'asset', target_id: ntdId,
        condition: { metric: 'weight_pct', operator: '>=' }, threshold: 20,
        message_template: '宁德时代仓位占比超过20%，建议关注集中度风险。',
      }))
    }

    // Alert 2: Price threshold — 贵州茅台 < 1500
    const moutaiId = assetIds['600519']
    if (moutaiId) {
      insertAlert.run(uuidv4(), 'price_threshold', moutaiId, JSON.stringify({
        type: 'price_threshold', target_type: 'asset', target_id: moutaiId,
        condition: { metric: 'price', operator: '<=' }, threshold: 1500,
        message_template: '贵州茅台股价跌破1500元，触发价格预警。',
      }))
    }

    // Alert 3: Drawdown — portfolio
    insertAlert.run(uuidv4(), 'drawdown', 'default', JSON.stringify({
      type: 'drawdown', target_type: 'portfolio', target_id: 'default',
      condition: { metric: 'max_drawdown', operator: '>=' }, threshold: 15,
      message_template: '投资组合最大回撤超过15%，请审视风险敞口。',
    }))
    console.log('[Seed]   Alerts: 3')

    // ---- 7. Risk snapshot ----
    db.prepare(`
      INSERT INTO risk_snapshots (id, portfolio_id, risk_score, volatility, max_drawdown, sharpe_ratio, beta, var_95, concentration_score, correlation_score, liquidity_score, sentiment_score, calculated_at)
      VALUES (?, 'default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    `).run(uuidv4(), 42.5, 15.8, 8.3, 1.25, 0.92, 2.8, 55.0, 35.0, 72.0, 58.0)
    console.log('[Seed]   Risk snapshot: 1')
  })

  seed()
  console.log('[Seed] Database seeded successfully.')
}

// ============================================================
// Standalone runner — `tsx electron/db/seed.ts`
// ============================================================
if (require.main === module) {
  const Database = require('better-sqlite3')
  const path = require('path')
  const dbPath = path.join(__dirname, '..', '..', '..', 'riskpilot-seed.db')
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Create tables first (mirror what initDatabase does)
  db.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY, symbol TEXT NOT NULL, market TEXT NOT NULL,
      name TEXT NOT NULL, asset_type TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'CNY',
      industry TEXT, style TEXT, exchange TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, account_id TEXT NOT NULL DEFAULT 'default',
      side TEXT NOT NULL, quantity REAL NOT NULL, price REAL NOT NULL,
      fee REAL DEFAULT 0, tax REAL DEFAULT 0, trade_time TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual', status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (asset_id) REFERENCES assets(id)
    );
    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, account_id TEXT NOT NULL DEFAULT 'default',
      quantity REAL NOT NULL DEFAULT 0, avg_cost REAL NOT NULL DEFAULT 0,
      cost_amount REAL NOT NULL DEFAULT 0, market_value REAL DEFAULT 0,
      unrealized_pnl REAL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (asset_id) REFERENCES assets(id)
    );
    CREATE TABLE IF NOT EXISTS market_quotes (
      id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, price REAL NOT NULL,
      change_pct REAL, volume REAL, turnover REAL, quote_time TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'simulated',
      FOREIGN KEY (asset_id) REFERENCES assets(id)
    );
    CREATE TABLE IF NOT EXISTS kline_bars (
      id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, period TEXT NOT NULL DEFAULT '1d',
      open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
      volume REAL, bar_time TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'simulated',
      FOREIGN KEY (asset_id) REFERENCES assets(id)
    );
    CREATE TABLE IF NOT EXISTS risk_snapshots (
      id TEXT PRIMARY KEY, portfolio_id TEXT NOT NULL DEFAULT 'default',
      risk_score REAL NOT NULL, volatility REAL, max_drawdown REAL, sharpe_ratio REAL,
      beta REAL, var_95 REAL, concentration_score REAL, correlation_score REAL,
      liquidity_score REAL, sentiment_score REAL,
      calculated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS news_items (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT, source TEXT NOT NULL,
      url TEXT, published_at TEXT NOT NULL, sentiment REAL,
      importance TEXT NOT NULL DEFAULT 'low', raw_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS news_asset_links (
      id TEXT PRIMARY KEY, news_id TEXT NOT NULL, asset_id TEXT NOT NULL,
      relevance REAL NOT NULL, event_type TEXT,
      FOREIGN KEY (news_id) REFERENCES news_items(id),
      FOREIGN KEY (asset_id) REFERENCES assets(id)
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY, alert_type TEXT NOT NULL,
      target_type TEXT NOT NULL DEFAULT 'asset', target_id TEXT NOT NULL,
      rule_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      triggered_at TEXT, acknowledged_at TEXT, resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY, report_type TEXT NOT NULL, title TEXT NOT NULL,
      content_markdown TEXT NOT NULL, source_context_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `)

  seedDatabase(db)
  db.close()
  console.log('[Seed] Output DB:', dbPath)
}
