// ============================================================
// Built-in Market Universe — popular stocks & funds for browsing
// These are NOT seeded into DB by default; they appear in MarketPage
// for users to browse and add to watchlist.
// ============================================================

export interface UniverseAsset {
  symbol: string
  market: string
  name: string
  asset_type: 'stock' | 'fund' | 'etf'
  industry: string | null
}

export const MARKET_UNIVERSE: UniverseAsset[] = [
  // ── 热门股票 ──
  { symbol: '300750', market: 'SZ', name: '宁德时代', asset_type: 'stock', industry: '新能源' },
  { symbol: '600519', market: 'SH', name: '贵州茅台', asset_type: 'stock', industry: '白酒' },
  { symbol: '00700', market: 'HK', name: '腾讯控股', asset_type: 'stock', industry: '互联网' },
  { symbol: '002594', market: 'SZ', name: '比亚迪', asset_type: 'stock', industry: '新能源车' },
  { symbol: '600036', market: 'SH', name: '招商银行', asset_type: 'stock', industry: '银行' },
  { symbol: '300274', market: 'SZ', name: '阳光电源', asset_type: 'stock', industry: '光伏' },
  { symbol: '000001', market: 'SZ', name: '平安银行', asset_type: 'stock', industry: '银行' },
  { symbol: '600276', market: 'SH', name: '恒瑞医药', asset_type: 'stock', industry: '医药' },
  { symbol: '002415', market: 'SZ', name: '海康威视', asset_type: 'stock', industry: '电子' },
  { symbol: '601318', market: 'SH', name: '中国平安', asset_type: 'stock', industry: '保险' },
  { symbol: '600900', market: 'SH', name: '长江电力', asset_type: 'stock', industry: '电力' },
  { symbol: '002352', market: 'SZ', name: '顺丰控股', asset_type: 'stock', industry: '物流' },
  { symbol: '600809', market: 'SH', name: '山西汾酒', asset_type: 'stock', industry: '白酒' },
  { symbol: '300059', market: 'SZ', name: '东方财富', asset_type: 'stock', industry: '金融' },
  { symbol: '601012', market: 'SH', name: '隆基绿能', asset_type: 'stock', industry: '光伏' },
  { symbol: '000858', market: 'SZ', name: '五粮液', asset_type: 'stock', industry: '白酒' },
  { symbol: '002230', market: 'SZ', name: '科大讯飞', asset_type: 'stock', industry: 'AI' },
  { symbol: '601888', market: 'SH', name: '中国中免', asset_type: 'stock', industry: '消费' },
  { symbol: '300014', market: 'SZ', name: '亿纬锂能', asset_type: 'stock', industry: '新能源' },
  { symbol: '600030', market: 'SH', name: '中信证券', asset_type: 'stock', industry: '券商' },
  { symbol: '002142', market: 'SZ', name: '宁波银行', asset_type: 'stock', industry: '银行' },
  { symbol: '600438', market: 'SH', name: '通威股份', asset_type: 'stock', industry: '光伏' },
  { symbol: '000333', market: 'SZ', name: '美的集团', asset_type: 'stock', industry: '家电' },
  { symbol: '601166', market: 'SH', name: '兴业银行', asset_type: 'stock', industry: '银行' },
  { symbol: '002475', market: 'SZ', name: '立讯精密', asset_type: 'stock', industry: '电子' },
  { symbol: '600887', market: 'SH', name: '伊利股份', asset_type: 'stock', industry: '食品' },
  { symbol: '000568', market: 'SZ', name: '泸州老窖', asset_type: 'stock', industry: '白酒' },
  { symbol: '601398', market: 'SH', name: '工商银行', asset_type: 'stock', industry: '银行' },
  { symbol: '002714', market: 'SZ', name: '牧原股份', asset_type: 'stock', industry: '农业' },
  { symbol: '601899', market: 'SH', name: '紫金矿业', asset_type: 'stock', industry: '有色' },

  // ── 宽基 ETF ──
  { symbol: '510300', market: 'SH', name: '沪深300ETF', asset_type: 'etf', industry: '宽基' },
  { symbol: '510500', market: 'SH', name: '中证500ETF', asset_type: 'etf', industry: '中盘' },
  { symbol: '588000', market: 'SH', name: '科创50ETF', asset_type: 'etf', industry: '科技' },
  { symbol: '512000', market: 'SH', name: '券商ETF', asset_type: 'etf', industry: '券商' },
  { symbol: '512690', market: 'SH', name: '酒ETF', asset_type: 'etf', industry: '白酒' },
  { symbol: '515030', market: 'SH', name: '新能源车ETF', asset_type: 'etf', industry: '新能源' },
  { symbol: '512170', market: 'SH', name: '医疗ETF', asset_type: 'etf', industry: '医疗' },
  { symbol: '512480', market: 'SH', name: '半导体ETF', asset_type: 'etf', industry: '半导体' },
  { symbol: '515790', market: 'SH', name: '光伏ETF', asset_type: 'etf', industry: '光伏' },
  { symbol: '159915', market: 'SZ', name: '创业板ETF', asset_type: 'etf', industry: '成长' },
  { symbol: '513180', market: 'SH', name: '恒生科技ETF', asset_type: 'etf', industry: '科技' },
  { symbol: '510050', market: 'SH', name: '上证50ETF', asset_type: 'etf', industry: '大盘' },

  // ── 热门主动基金 ──
  { symbol: '005827', market: 'SH', name: '易方达蓝筹精选', asset_type: 'fund', industry: '混合' },
  { symbol: '003095', market: 'SH', name: '中欧医疗健康A', asset_type: 'fund', industry: '医疗' },
  { symbol: '000961', market: 'SH', name: '天弘沪深300A', asset_type: 'fund', industry: '指数' },
  { symbol: '001938', market: 'SH', name: '中欧时代先锋A', asset_type: 'fund', industry: '混合' },
  { symbol: '002190', market: 'SH', name: '农银新能源主题', asset_type: 'fund', industry: '新能源' },
  { symbol: '004070', market: 'SH', name: '南方中证全指证券', asset_type: 'fund', industry: '券商' },
  { symbol: '110022', market: 'SH', name: '易方达消费行业', asset_type: 'fund', industry: '消费' },
  { symbol: '163406', market: 'SZ', name: '兴全合润混合', asset_type: 'fund', industry: '混合' },
  { symbol: '519674', market: 'SH', name: '银河创新成长A', asset_type: 'fund', industry: '科技' },
  { symbol: '001410', market: 'SH', name: '信达澳银新能源产业', asset_type: 'fund', industry: '新能源' },
  { symbol: '005911', market: 'SH', name: '广发双擎升级A', asset_type: 'fund', industry: '科技' },
  { symbol: '000979', market: 'SH', name: '景顺长城沪港深精选', asset_type: 'fund', industry: '混合' },
  { symbol: '008975', market: 'SH', name: '富国成长策略', asset_type: 'fund', industry: '成长' },
  { symbol: '003494', market: 'SH', name: '南方全指证券联接', asset_type: 'fund', industry: '券商' },
  { symbol: '004243', market: 'SH', name: '万家经济新动能A', asset_type: 'fund', industry: '混合' },
]
