interface ScoreRingProps {
  score: number
  label: string
  level: 'low' | 'medium' | 'high' | 'critical'
}

const levelColors: Record<ScoreRingProps['level'], string> = {
  low: 'var(--green)',
  medium: 'var(--orange)',
  high: 'var(--red)',
  critical: '#b71c1c',
}

const levelLabels: Record<ScoreRingProps['level'], string> = {
  low: '低风险',
  medium: '中等风险',
  high: '高风险',
  critical: '极危',
}

export function ScoreRing({ score, label, level }: ScoreRingProps) {
  const pct = Math.min(100, Math.max(0, score))
  const color = levelColors[level]

  return (
    <div className="score-ring">
      <div
        className="ring"
        style={{
          background: `radial-gradient(circle at center, #ffffff 0 55%, transparent 57%), conic-gradient(${color} 0 ${pct}%, #e5ebf0 ${pct}% 100%)`,
        }}
      >
        <strong>{pct}</strong>
        <span>{label}</span>
      </div>
      <p>
        当前风险等级：
        <b style={{ color }}>{levelLabels[level]}</b>
      </p>
    </div>
  )
}
