import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App.jsx'
import './styles.css'
import './ui/cell-world.css'
import './ui/movement-corrections.css'

const BUILD_COMMIT = __BUILD_COMMIT__
const BUILD_BRANCH = __BUILD_BRANCH__

function viewFromHash() {
  if (window.location.hash === '#thermal-lab') return 'thermal'
  if (window.location.hash === '#graphics-lab') return 'graphics'
  return 'inertia'
}

function PlaceholderLab({ eyebrow, title, children }) {
  return (
    <main className="prototype-placeholder">
      <p>{eyebrow}</p>
      <h1>{title}</h1>
      <div>{children}</div>
    </main>
  )
}

function Root() {
  const [view, setView] = useState(() => viewFromHash())

  useEffect(() => {
    const onHashChange = () => setView(viewFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const navigate = (next) => {
    window.location.hash = next === 'thermal' ? 'thermal-lab' : next === 'graphics' ? 'graphics-lab' : 'hex-prototype'
  }

  return (
    <>
      <div className="app-switcher">
        <div className="app-switcher__identity">
          <strong>ProjectC Web Prototype</strong>
          <span className="build-revision build-revision--verified" title={BUILD_COMMIT}>
            <i className="build-revision__dot" />
            <code>{BUILD_BRANCH}@{BUILD_COMMIT.slice(0, 8)}</code>
          </span>
        </div>
        <nav aria-label="Prototype views">
          <button type="button" className={view === 'inertia' ? 'selected' : ''} onClick={() => navigate('inertia')}>Inertia Driving Lab</button>
          <button type="button" className={view === 'thermal' ? 'selected' : ''} onClick={() => navigate('thermal')}>Thermal Clock Lab</button>
          <button type="button" className={view === 'graphics' ? 'selected' : ''} onClick={() => navigate('graphics')}>图形性能实验室</button>
        </nav>
      </div>
      {view === 'inertia' && <App />}
      {view === 'thermal' && (
        <PlaceholderLab eyebrow="ProjectC · reserved test space" title="Thermal Clock Lab">
          当前热力钟摆已经恢复到 Inertia Driving Lab 左栏；这里保留为后续独立热力机制实验空间。
        </PlaceholderLab>
      )}
      {view === 'graphics' && (
        <PlaceholderLab eyebrow="ProjectC · archived test space" title="图形性能实验室">
          当前精简运行时暂未重新接入旧 Graphics Lab；入口保留，后续可以独立恢复而不干扰惯性原型。
        </PlaceholderLab>
      )}
    </>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
