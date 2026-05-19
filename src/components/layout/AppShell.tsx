import { type ReactNode } from 'react'
import { useAppStore } from '@/stores/app.store'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { AssistantDrawer } from './AssistantDrawer'

export function AppShell({ children }: { children: ReactNode }) {
  const drawerOpen = useAppStore((s) => s.drawerOpen)

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main">
        <TopBar />
        {children}
      </main>
      {drawerOpen && <AssistantDrawer />}
    </div>
  )
}
