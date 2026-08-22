import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BuildRevision } from './BuildRevision'
import { GraphicsLab } from './graphics/GraphicsLab'
import { ActorLoopReachabilityABPlayground } from './hex/ActorLoopReachabilityABPlayground'
import './styles.css'

type View = 'field' | 'graphics'

function viewFromHash(): View {
  return window.location.hash === '#graphics-lab' ? 'graphics' : 'field'
}

function Root() {
  const [view, setView] = useState<View>(() => viewFromHash())

  useEffect(() => {
    const handleHashChange = () => setView(viewFromHash())
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const navigate = (next: View) => {
    window.location.hash = next === 'graphics' ? 'graphics-lab' : 'hex-prototype'
  }

  return (
    <>
      <div className="app-switcher">
        <div className="app-switcher__identity">
          <strong>ProjectC Web Prototype</strong>
          <BuildRevision />
        </div>
        <nav aria-label="Prototype views">
          <button className={view === 'field' ? 'selected' : ''} onClick={() => navigate('field')}>
            Inertia Field A/B
          </button>
          <button className={view === 'graphics' ? 'selected' : ''} onClick={() => navigate('graphics')}>
            图形性能实验室
          </button>
        </nav>
      </div>
      {view === 'field' && <ActorLoopReachabilityABPlayground />}
      {view === 'graphics' && <GraphicsLab />}
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
