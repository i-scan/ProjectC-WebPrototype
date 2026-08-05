import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { GraphicsLab } from './graphics/GraphicsLab'
import { HexPrototype } from './hex/HexPrototype'
import { RightInspectorChrome } from './hex/RightInspectorChrome'
import { VisualFeedbackObserver } from './visual/VisualFeedbackObserver'
import { VisualPrototype } from './visual/VisualPrototype'
import './styles.css'
import './visual/visual-v3.css'
import './visual/inspector-fix.css'
import './hex/thermal-clock-inspector.css'
import './hex/right-inspector-v5.css'

type View = 'rules' | 'visual' | 'hex' | 'graphics'

function viewFromHash(): View {
  if (window.location.hash === '#graphics-lab') return 'graphics'
  if (window.location.hash === '#hex-prototype') return 'hex'
  if (window.location.hash === '#visual-prototype') return 'visual'
  return 'rules'
}

function Root() {
  const [view, setView] = useState<View>(() => viewFromHash())

  useEffect(() => {
    const handleHashChange = () => setView(viewFromHash())
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const navigate = (next: View) => {
    window.location.hash = next === 'graphics'
      ? 'graphics-lab'
      : next === 'hex'
        ? 'hex-prototype'
        : next === 'visual'
          ? 'visual-prototype'
          : 'rules-lab'
  }

  const visualView = view === 'visual' || view === 'hex'

  return (
    <>
      <div className="app-switcher">
        <strong>ProjectC Web Prototype</strong>
        <nav aria-label="Prototype views">
          <button className={view === 'rules' ? 'selected' : ''} onClick={() => navigate('rules')}>
            规则实验室
          </button>
          <button className={view === 'visual' ? 'selected' : ''} onClick={() => navigate('visual')}>
            Square4
          </button>
          <button className={view === 'hex' ? 'selected' : ''} onClick={() => navigate('hex')}>
            Hex6
          </button>
          <button className={view === 'graphics' ? 'selected' : ''} onClick={() => navigate('graphics')}>
            图形性能实验室
          </button>
        </nav>
      </div>
      {view === 'rules' && <App />}
      {view === 'visual' && <VisualPrototype />}
      {view === 'hex' && (
        <>
          <HexPrototype />
          <RightInspectorChrome />
        </>
      )}
      {view === 'graphics' && <GraphicsLab />}
      {visualView && <VisualFeedbackObserver />}
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
