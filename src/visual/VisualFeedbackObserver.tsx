import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import './visual-feedback.css'

type FeedbackKind =
  | 'card-play'
  | 'draw'
  | 'discard'
  | 'attack'
  | 'heat'
  | 'cool'
  | 'freeze'
  | 'melt'
  | 'ignite'
  | 'vapor'
  | 'wind'
  | 'rain'
  | 'rain-intent'
  | 'cloud'
  | 'phase'
  | 'reset'

type Feedback = {
  id: number
  kind: FeedbackKind
  label: string
  amount?: number
  cardName?: string
}

function classify(label: string, banner: HTMLElement): FeedbackKind {
  const normalized = label.toLowerCase()
  if (label.includes('打出「')) return 'card-play'
  if (label.startsWith('抽取')) return 'draw'
  if (label.includes('弃置') && label.includes('手牌')) return 'discard'
  if (label.includes('water → ice') || label.includes('冻结')) return 'freeze'
  if (label.includes('ice → water') || label.includes('融化')) return 'melt'
  if (label.includes('→ fire') || label.includes('点燃')) return 'ignite'
  if (label.includes('蒸发') || label.includes('形成 cloud')) return 'vapor'
  if (label.includes('风向')) return 'wind'
  if (label.includes('降雨预告')) return 'rain-intent'
  if (label.includes('降雨结算') || label.includes('fire → none')) return 'rain'
  if (label.includes('sky clear → cloud')) return 'cloud'
  if (label.includes('受到') && label.includes('伤害')) return 'attack'
  if (banner.classList.contains('attack')) return 'attack'
  if (banner.classList.contains('heat') || normalized.includes('温度 +')) return 'heat'
  if (banner.classList.contains('cool') || normalized.includes('温度 -')) return 'cool'
  if (banner.classList.contains('guard')) return 'phase'
  if (normalized.includes('重置') || normalized.includes('悔棋') || normalized.includes('重新开始')) return 'reset'
  return 'phase'
}

function parseFeedback(banner: HTMLElement): Feedback | undefined {
  const label = banner.querySelector('strong')?.textContent?.trim()
  if (!label) return undefined
  const amountMatch = label.match(/(?:受到|变化|抽取|弃置)\s*(\d+)/)
  const cardMatch = label.match(/「([^」]+)」/)
  return {
    id: Date.now() + Math.random(),
    kind: classify(label, banner),
    label,
    amount: amountMatch ? Number(amountMatch[1]) : undefined,
    cardName: cardMatch?.[1],
  }
}

function repeat(count: number) {
  return Array.from({ length: count }, (_, index) => index)
}

function FeedbackVisual({ feedback }: { feedback: Feedback }) {
  const { kind } = feedback
  return (
    <div className={`visual-feedback-layer feedback-${kind}`} aria-hidden="true">
      {kind === 'card-play' && (
        <>
          <div className="feedback-card-cast">
            <span>介入物</span>
            <strong>{feedback.cardName ?? 'Card'}</strong>
            <i />
          </div>
          <div className="feedback-cast-beam" />
        </>
      )}

      {kind === 'draw' && (
        <div className="feedback-draw-cards">
          {repeat(Math.min(5, feedback.amount ?? 3)).map((index) => <i key={index} style={{ '--index': index } as React.CSSProperties} />)}
        </div>
      )}

      {kind === 'discard' && (
        <div className="feedback-discard-cards">
          {repeat(Math.min(5, feedback.amount ?? 3)).map((index) => <i key={index} style={{ '--index': index } as React.CSSProperties} />)}
        </div>
      )}

      {kind === 'attack' && (
        <>
          <div className="feedback-impact-core" />
          <div className="feedback-slash slash-a" />
          <div className="feedback-slash slash-b" />
          <strong className="feedback-damage-number">-{feedback.amount ?? 1}</strong>
          <div className="feedback-impact-particles">
            {repeat(12).map((index) => <i key={index} style={{ '--index': index } as React.CSSProperties} />)}
          </div>
        </>
      )}

      {(kind === 'heat' || kind === 'ignite') && (
        <>
          <div className="feedback-heat-haze" />
          <div className="feedback-embers">
            {repeat(kind === 'ignite' ? 18 : 10).map((index) => <i key={index} style={{ '--index': index } as React.CSSProperties} />)}
          </div>
          {kind === 'ignite' && <div className="feedback-flame-burst" />}
        </>
      )}

      {(kind === 'cool' || kind === 'freeze') && (
        <>
          <div className="feedback-cold-mist" />
          <div className="feedback-ice-shards">
            {repeat(kind === 'freeze' ? 16 : 9).map((index) => <i key={index} style={{ '--index': index } as React.CSSProperties} />)}
          </div>
          {kind === 'freeze' && <div className="feedback-freeze-ring" />}
        </>
      )}

      {kind === 'melt' && (
        <>
          <div className="feedback-melt-glow" />
          <div className="feedback-droplets">{repeat(9).map((index) => <i key={index} style={{ '--index': index } as React.CSSProperties} />)}</div>
        </>
      )}

      {(kind === 'vapor' || kind === 'cloud') && (
        <>
          <div className="feedback-steam">{repeat(7).map((index) => <i key={index} style={{ '--index': index } as React.CSSProperties} />)}</div>
          <div className="feedback-cloud-puff">{repeat(5).map((index) => <i key={index} style={{ '--index': index } as React.CSSProperties} />)}</div>
        </>
      )}

      {kind === 'wind' && (
        <div className="feedback-wind-lines">{repeat(9).map((index) => <i key={index} style={{ '--index': index } as React.CSSProperties} />)}</div>
      )}

      {(kind === 'rain' || kind === 'rain-intent') && (
        <>
          <div className={`feedback-rain-lines ${kind === 'rain-intent' ? 'intent' : ''}`}>
            {repeat(kind === 'rain' ? 18 : 9).map((index) => <i key={index} style={{ '--index': index } as React.CSSProperties} />)}
          </div>
          <div className="feedback-ripples">{repeat(5).map((index) => <i key={index} style={{ '--index': index } as React.CSSProperties} />)}</div>
        </>
      )}

      {kind === 'phase' && <div className="feedback-phase-sweep" />}
      {kind === 'reset' && <div className="feedback-reset-ring" />}
    </div>
  )
}

export function VisualFeedbackObserver() {
  const [feedback, setFeedback] = useState<Feedback>()
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    let previousLabel = ''
    let previousBanner: HTMLElement | null = null
    let cleanupTimer = 0

    const applyFeedback = () => {
      const frame = document.querySelector<HTMLElement>('.visual-board-frame')
      const banner = document.querySelector<HTMLElement>('.visual-event-banner')
      setHost(frame)
      if (!banner) return
      const parsed = parseFeedback(banner)
      if (!parsed) return
      if (banner === previousBanner && parsed.label === previousLabel) return
      previousBanner = banner
      previousLabel = parsed.label
      setFeedback(parsed)

      frame?.classList.remove('feedback-impact-shake', 'feedback-heat-flash', 'feedback-cool-flash')
      void frame?.offsetWidth
      if (parsed.kind === 'attack') frame?.classList.add('feedback-impact-shake')
      if (parsed.kind === 'heat' || parsed.kind === 'ignite' || parsed.kind === 'vapor') frame?.classList.add('feedback-heat-flash')
      if (parsed.kind === 'cool' || parsed.kind === 'freeze' || parsed.kind === 'rain') frame?.classList.add('feedback-cool-flash')

      if (parsed.kind === 'draw') {
        const cards = [...document.querySelectorAll<HTMLElement>('.visual-card')]
        const count = Math.min(cards.length, parsed.amount ?? cards.length)
        cards.slice(-count).forEach((card, index) => {
          card.classList.remove('feedback-card-drawn')
          card.style.setProperty('--draw-index', String(index))
          void card.offsetWidth
          card.classList.add('feedback-card-drawn')
        })
      }

      window.clearTimeout(cleanupTimer)
      cleanupTimer = window.setTimeout(() => {
        frame?.classList.remove('feedback-impact-shake', 'feedback-heat-flash', 'feedback-cool-flash')
        document.querySelectorAll<HTMLElement>('.feedback-card-drawn').forEach((card) => card.classList.remove('feedback-card-drawn'))
      }, 980)
    }

    const observer = new MutationObserver(applyFeedback)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true })
    applyFeedback()
    return () => {
      observer.disconnect()
      window.clearTimeout(cleanupTimer)
    }
  }, [])

  if (!feedback || !host) return null
  return createPortal(<FeedbackVisual key={feedback.id} feedback={feedback} />, host)
}
