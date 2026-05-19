import { v4 as uuidv4 } from 'uuid'
import type { NewsItem, NewsAssetLink, Importance } from '../../../shared/types/database'
import type { INewsProvider } from './interface'

/**
 * Mock news provider — returns locally seeded demo news.
 * Used as fallback when no real news API is configured.
 */
export class MockNewsProvider implements INewsProvider {
  readonly id = 'mock-news'
  readonly provider = 'mock'
  readonly name = '本地模拟舆情'

  private newsData: NewsItem[] = []
  private linksData: NewsAssetLink[] = []
  private initialized = false

  private init() {
    if (this.initialized) return
    this.initialized = true

    // Built-in demo news (subset of seed.ts NEWS_SEEDS)
    const seeds: Array<{
      title: string
      summary: string
      source: string
      published_at: string
      sentiment: number
      importance: Importance
      linkedSymbols: string[]
      relevanceScores: number[]
      eventTypes: (string | null)[]
    }> = [
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
    ]

    // Map symbol → asset_id using a deterministic hash (since we don't have DB access here)
    // In real usage, the caller resolves symbols to asset_ids via the database
    const symbolToId = (symbol: string): string => {
      let hash = 0
      for (let i = 0; i < symbol.length; i++) {
        hash = ((hash << 5) - hash) + symbol.charCodeAt(i)
        hash |= 0
      }
      return `asset-${Math.abs(hash).toString(16).padStart(8, '0')}`
    }

    for (const s of seeds) {
      const newsId = uuidv4()
      this.newsData.push({
        id: newsId,
        title: s.title,
        summary: s.summary,
        source: s.source,
        url: null,
        published_at: s.published_at,
        sentiment: s.sentiment,
        importance: s.importance,
        raw_hash: this.simpleHash(s.title + s.published_at),
        created_at: s.published_at,
      })

      for (let i = 0; i < s.linkedSymbols.length; i++) {
        this.linksData.push({
          id: uuidv4(),
          news_id: newsId,
          asset_id: symbolToId(s.linkedSymbols[i]),
          relevance: s.relevanceScores[i] ?? 0.5,
          event_type: s.eventTypes[i] ?? null,
        })
      }
    }
  }

  async fetchNews(options?: { limit?: number; importance?: Importance; since?: string }): Promise<NewsItem[]> {
    this.init()
    let result = [...this.newsData]

    if (options?.importance) {
      result = result.filter((n) => n.importance === options.importance)
    }
    if (options?.since) {
      result = result.filter((n) => n.published_at >= options.since!)
    }

    result.sort((a, b) => b.published_at.localeCompare(a.published_at))

    if (options?.limit) {
      result = result.slice(0, options.limit)
    }

    return result
  }

  async fetchNewsLinks(newsIds: string[]): Promise<NewsAssetLink[]> {
    this.init()
    return this.linksData.filter((l) => newsIds.includes(l.news_id))
  }

  async healthCheck(): Promise<boolean> {
    return true
  }

  private simpleHash(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i)
      hash |= 0
    }
    return Math.abs(hash).toString(16).padStart(8, '0')
  }
}
