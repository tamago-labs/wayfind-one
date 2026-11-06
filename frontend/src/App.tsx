import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Login from './pages/Login'
import DocsLayout from './docs/DocsLayout'
import DocsIntro from './docs/pages/Intro'
import DocsQuickstart from './docs/pages/Quickstart'
import DocsCli from './docs/pages/Cli'
import DocsP2p from './docs/pages/P2p'
import DocsSandbox from './docs/pages/Sandbox'
import DocsInference from './docs/pages/Inference'
import DocsPolicy from './docs/pages/Policy'
import DocsBots from './docs/pages/BotsTasks'
import DocsPrivacy from './docs/pages/Privacy'
import DocsChangelog from './docs/pages/Changelog'
import './App.css'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/docs" element={<DocsLayout />}>
          <Route index element={<DocsIntro />} />
          <Route path="quickstart" element={<DocsQuickstart />} />
          <Route path="cli" element={<DocsCli />} />
          <Route path="p2p" element={<DocsP2p />} />
          <Route path="sandbox" element={<DocsSandbox />} />
          <Route path="inference" element={<DocsInference />} />
          <Route path="policy" element={<DocsPolicy />} />
          <Route path="bots-tasks" element={<DocsBots />} />
          <Route path="privacy" element={<DocsPrivacy />} />
          <Route path="changelog" element={<DocsChangelog />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
