import React from 'react'

export interface RiskFactor {
  name: string
  value: number // 0-100
}

interface RiskRadarProps {
  riskScore: number
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  factors: RiskFactor[]
  description?: string
  loading?: boolean
}

const RISK_LEVEL_LABELS: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '极高'
}

export function RiskRadar({
  riskScore,
  riskLevel,
  factors,
  description,
  loading = false
}: RiskRadarProps) {
  if (loading) {
    return (
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>风险雷达</h2>
            <p>组合风险分解</p>
          </div>
          <div className="risk-pill">
            <div className="skeleton" style={{ width: 28, height: 14, borderRadius: 999 }} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 32, borderRadius: 8 }} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2>风险雷达</h2>
          <p>组合风险分解</p>
        </div>
        <div className="risk-pill">{RISK_LEVEL_LABELS[riskLevel]}</div>
      </div>

      {/* Score ring */}
      <div className="score-ring">
        <div className="ring" style={{ background: `radial-gradient(circle at center, #ffffff 0 55%, transparent 57%), conic-gradient(var(--red) 0 ${riskScore}%, #e5ebf0 ${riskScore}% 100%)` }}>
          <strong>{riskScore}</strong>
          <span>/100</span>
        </div>
        <p>
          风险等级: <b className="danger">{RISK_LEVEL_LABELS[riskLevel]}</b>
          <br />
          {description || '集中度和最大回撤是当前主要风险来源'}
        </p>
      </div>

      {/* Risk factor bars */}
      <div className="risk-bars">
        {factors.map((factor) => (
          <div key={factor.name} className="risk-row">
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>{factor.name}</span>
            <div>
              <i
                style={{
                  width: `${factor.value}%`,
                  background: `linear-gradient(90deg, var(--green), var(--yellow), var(--red))`
                }}
              />
            </div>
            <b>{factor.value}%</b>
          </div>
        ))}
      </div>
    </div>
  )
}
