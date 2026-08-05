import { useEffect } from 'react'

const ROOT_SELECTOR = '.hex-prototype'
const TABS_SELECTOR = '.hex-inspector-tabs'
const COORD_SOURCE_SELECTOR = '.hex-inspector-pane > .visual-section-heading span'
const SHARED_COORD_CLASS = 'hex-inspector-shared-coordinate'

function syncInspectorChrome() {
  const root = document.querySelector<HTMLElement>(ROOT_SELECTOR)
  const tabs = root?.querySelector<HTMLElement>(TABS_SELECTOR)
  if (!root || !tabs) return

  const buttons = Array.from(tabs.querySelectorAll<HTMLButtonElement>('button[role="tab"]'))
  const thermalActive = buttons.some((button) => (
    button.textContent?.includes('Thermal')
    && button.getAttribute('aria-selected') === 'true'
  ))

  root.classList.toggle('inspector-thermal', thermalActive)
  root.classList.toggle('inspector-hex', !thermalActive)

  let sharedCoordinate = tabs.querySelector<HTMLElement>(`.${SHARED_COORD_CLASS}`)
  if (!sharedCoordinate) {
    sharedCoordinate = document.createElement('span')
    sharedCoordinate.className = SHARED_COORD_CLASS
    sharedCoordinate.setAttribute('role', 'status')
    sharedCoordinate.setAttribute('aria-live', 'polite')
    tabs.append(sharedCoordinate)
  }

  const coordinateSource = root.querySelector<HTMLElement>(COORD_SOURCE_SELECTOR)
  const nextText = coordinateSource?.textContent?.trim() || 'Cell —'
  if (sharedCoordinate.textContent !== nextText) sharedCoordinate.textContent = nextText
}

export function RightInspectorChrome() {
  useEffect(() => {
    let animationFrame = window.requestAnimationFrame(syncInspectorChrome)
    const observer = new MutationObserver(() => {
      window.cancelAnimationFrame(animationFrame)
      animationFrame = window.requestAnimationFrame(syncInspectorChrome)
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-selected', 'class', 'hidden'],
      characterData: true,
    })

    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(animationFrame)
      const root = document.querySelector<HTMLElement>(ROOT_SELECTOR)
      root?.classList.remove('inspector-thermal', 'inspector-hex')
      root?.querySelector(`.${SHARED_COORD_CLASS}`)?.remove()
    }
  }, [])

  return null
}
