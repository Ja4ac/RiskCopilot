import { useAlertStore } from '@/stores/alert.store'
import { AlertList } from './AlertList'

export function AlertListPanel() {
  const alerts = useAlertStore((s) => s.alerts)
  const loading = useAlertStore((s) => s.loading)
  const error = useAlertStore((s) => s.error)

  const alertItems = alerts.map((a) => {
    let ruleJson: Record<string, unknown> = {}
    try {
      ruleJson = JSON.parse(a.rule_json || '{}')
    } catch { /* ignore parse errors */ }

    return {
      id: a.id,
      title: (ruleJson.message as string) || a.alert_type,
      description: `类型: ${a.alert_type} | 状态: ${a.status}`,
      severity: (a.status === 'triggered' ? 'severe' : 'normal') as 'severe' | 'normal',
    }
  })

  return (
    <AlertList
      alerts={alertItems}
      count={alerts.length}
      loading={loading && alerts.length === 0}
    />
  )
}
