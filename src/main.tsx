import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BuildRevision } from './BuildRevision'
import { GraphicsLab } from './graphics/GraphicsLab'
import { ActorLoopPlayground } from './hex/ActorLoopPlayground'
import { ActorLoopUt7BasicMovePlayground } from './hex/ActorLoopUt7BasicMovePlayground'
import { HexPrototype } from './hex/HexPrototype'
import { InspectorLayoutContract } from './hex/InspectorLayoutContract'
import { Ut5InertiaLab } from './hex/Ut5InertiaLab'
import { VisualFeedbackObserver } from './visual/VisualFeedbackObserver'
import { VisualPrototype } from './visual/VisualPrototype'
import './styles.css'
import './visual/visual-v3.css'
import './visual/inspector-fix.css'
import './hex/right-inspector.css'

type View = 'rules' | 'visual' | 'hex' | 'hex-ut6' | 'hex-legacy' | 'graphics'

function viewFromHash(): View {
  if (window.location.hash === '#graphics-lab') return 'graphics'
  if (window.location.hash === '#hex-prototype') return 'hex'
  if (window.location.hash === '#hex-ut6') return 'hex-ut6'
  if (window.location.hash === '#hex-legacy') return 'hex-legacy'
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
        : next === 'hex-ut6'
          ? 'hex-ut6'
          : next === 'hex-legacy'
            ? 'hex-legacy'
            : next === 'visual'
              ? 'visual-prototype'
              : 'rules-lab'
  }

  const visualView = view === 'visual' || view === 'hex-legacy'

  return (
    <>
      <div className="app-switcher">
        <div className="app-switcher__identity">
          <strong>ProjectC Web Prototype</strong>
          <BuildRevision />
        </div>
        <nav aria-label="Prototype views">
          <button className={view === 'hex' ? 'selected' : ''} onClick={() => navigate('hex')}>
            Inertia Driving UT7
          </button>
          <button className={view === 'hex-ut6' ? 'selected' : ''} onClick={() => navigate('hex-ut6')}>
            Actor Loop UT6 History
          </button>
          <button className={view === 'rules' ? 'selected' : ''} onClick={() => navigate('rules')}>
            惯性实验室 UT5
          </button>
          <button className={view === 'visual' ? 'selected' : ''} onClick={() => navigate('visual')}>
            Square4
          </button>
          <button className={view === 'graphics' ? 'selected' : ''} onClick={() => navigate('graphics')}>
            图形性能实验室
          </button>
        </nav>
      </div>
      {view === 'hex' && <ActorLoopUt7BasicMovePlayground />}
      {view === 'hex-ut6' && <ActorLoopPlayground />}
      {view === 'rules' && <Ut5InertiaLab />}
      {view === 'visual' && <VisualPrototype />}
      {view === 'hex-legacy' && <HexPrototype />}
      {view === 'graphics' && <GraphicsLab />}
      {visualView && <VisualFeedbackObserver />}
      {view === 'hex-legacy' && <InspectorLayoutContract />}
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
