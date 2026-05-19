import { useRiskStore } from '@/stores/risk.store'
import { RiskRadar } from './RiskRadar'
import type { RiskFactor } from './RiskRadar'

export function RiskRadarPanel() {
  const summary = useRiskStore((s) => s.summary)
  const loading = useRiskStore((s) => s.loading)

  const riskScore = summary?.risk_score ?? 0
  const riskLevel = summary?.risk_level ?? 'medium'

  // Map RiskSummary fields to RiskFactor array
  const factors: RiskFactor[] = summary
    ? [
        { name: '波动率', value: summary.volatility_score },
        { name: '最大回撤', value: summary.drawdown_score },
        { name: '集中度', value: summary.concentration_score },
        { name: '相关性', value: summary.correlation_score },
        { name: '流动性', value: summary.liquidity_score },
        { name: '舆情', value: summary.sentiment_score },
      ]
    : []

  const description = summary
    ? `组合风险处于${riskLevel === 'low' ? '较低' : riskLevel === 'medium' ? '中等' : riskLevel === 'high' ? '偏高' : '极高'}水平`
    : undefined

  return (
    <RiskRadar
      riskScore={riskScore}
      riskLevel={riskLevel}
      factors={factors}
      description={description}
      loading={loading && !summary}
    />
  )
}
