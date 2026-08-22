import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App.jsx'
import './styles.css'
import './ui/cell-world.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
