import { useAppStore } from '@/stores/app.store'
import { AppShell } from '@/components/layout/AppShell'
import { DashboardPage } from '@/pages/DashboardPage'
import { PositionsPage } from '@/pages/PositionsPage'
import { MarketPage } from '@/pages/MarketPage'
import { RiskPage } from '@/pages/RiskPage'
import { NewsPage } from '@/pages/NewsPage'
import { AIAssistantPage } from '@/pages/AIAssistantPage'
import { ReportsPage } from '@/pages/ReportsPage'
import { SettingsPage } from '@/pages/SettingsPage'

const pages: Record<string, React.FC> = {
  dashboard: DashboardPage,
  positions: PositionsPage,
  market: MarketPage,
  risk: RiskPage,
  news: NewsPage,
  ai: AIAssistantPage,
  reports: ReportsPage,
  settings: SettingsPage,
}

export default function App() {
  const activePage = useAppStore((s) => s.activePage)
  const PageComponent = pages[activePage] ?? DashboardPage

  return (
    <AppShell>
      <PageComponent />
    </AppShell>
  )
}
