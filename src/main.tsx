import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { GraphicsLab } from './graphics/GraphicsLab'
import './styles.css'

type View = 'rules' | 'graphics'

function viewFromHash(): View {
  return window.location.hash === '#graphics-lab' ? 'graphics' : 'rules'
}

function Root() {
  const [view, setView] = useState<View>(() => viewFromHash())

  useEffect(() => {
    const handleHashChange = () => setView(viewFromHash())
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const navigate = (next: View) => {
    window.location.hash = next === 'graphics' ? 'graphics-lab' : 'rules-lab'
  }

  return (
    <>
      <div className="app-switcher">
        <strong>ProjectC Web Prototype</strong>
        <nav aria-label="Prototype views">
          <button className={view === 'rules' ? 'selected' : ''} onClick={() => navigate('rules')}>
            规则实验室
          </button>
          <button className={view === 'graphics' ? 'selected' : ''} onClick={() => navigate('graphics')}>
            图形性能实验室
          </button>
        </nav>
      </div>
      {view === 'rules' ? <App /> : <GraphicsLab />}
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
