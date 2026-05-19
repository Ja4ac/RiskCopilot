import { useEffect } from 'react'
import { useAlertStore } from '@/stores/alert.store'
import { useAppStore } from '@/stores/app.store'
import { Panel } from '../ui/Panel'

export function AlertSummaryPanel() {
  const { alerts, loading, fetchAlerts } = useAlertStore()
  const setActivePage = useAppStore((s) => s.setActivePage)

  useEffect(() => {
    fetchAlerts()
  }, [])

  const triggeredAlerts = alerts.filter((a) => a.status === 'triggered')
  const pendingAlerts = alerts.filter((a) => a.status === 'pending')
  const displayAlerts = [...triggeredAlerts, ...pendingAlerts].slice(0, 3)

  return (
    <Panel
      title="预警提醒"
      subtitle={triggeredAlerts.length > 0 ? `${triggeredAlerts.length} 条已触发` : '暂无触发预警'}
      actions={
        <button className="text-button" onClick={() => setActivePage('risk')}>
          查看全部 →
        </button>
      }
    >
      {loading && displayAlerts.length === 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 56, borderRadius: 8 }} />
          ))}
        </div>
      ) : displayAlerts.length === 0 ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          暂无预警提醒
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {displayAlerts.map((a) => {
            let ruleJson: Record<string, unknown> = {}
            try {
              ruleJson = JSON.parse(a.rule_json || '{}')
            } catch { /* ignore */ }

            const isTriggered = a.status === 'triggered'
            return (
              <div
                key={a.id}
                className={`alert-item ${isTriggered ? 'severe' : ''}`}
                style={{ padding: '10px 12px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: isTriggered ? '#d33f3f' : '#c99a05',
                    flexShrink: 0,
                  }} />
                  <b style={{ fontSize: 13 }}>{(ruleJson.message_template as string) || a.alert_type}</b>
                </div>
                <p style={{ margin: '4px 0 0 16px', fontSize: 12, color: 'var(--muted)' }}>
                  类型: {a.alert_type} | {isTriggered ? '已触发' : '监控中'}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}
