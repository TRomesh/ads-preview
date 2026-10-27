import { useRef } from 'react'
import { components, origin, previewUrl, type Selection } from './components'
import { usePreview } from './usePreview'
import './App.css'

// The tile on screen, and the iframe behind it. The frame is twice the tile
// and drawn at half size, so the tile is just the frame shrunk — one
// constant, no per-component maths.
//
// Frame width is the width the component lays out at, and text in the tile
// ends up at SCALE of its real size. Doubling keeps that at half. Lay out at
// 1280 instead and 36px type lands at 5px. The cost of a narrow frame is that
// components show their narrow layout.
const TILE = { width: 171.391, height: 96.406 }
const SCALE = 0.5
const FRAME = { width: TILE.width / SCALE, height: TILE.height / SCALE }

// The only origin we accept messages from. `origin` may carry a path, so take
// the bare origin — that is what `event.origin` is compared against.
const previewOrigin = new URL(origin).origin

// `HeadingElement · HeadingStyles · level: h3`
function label({ contentType, displayTemplate, settings }: Selection) {
  const applied = Object.entries(settings ?? {})
    .map(([setting, value]) => `${setting}: ${value}`)
    .join(', ')

  return [contentType, displayTemplate, applied].filter(Boolean).join(' · ')
}

function CmsTile({ selection }: { selection: Selection }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const { dimensions, error, timedOut, onLoad } = usePreview(frame, {
    origin: previewOrigin,
  })

  const name = label(selection)

  // Caption text and tile styling only. The tile is a fixed box either way,
  // so none of this moves the layout.
  const status =
    error ? 'error'
    : dimensions ?
      `${Math.round(dimensions.width)}×${Math.round(dimensions.height)}`
    : timedOut ? 'unmeasured'
    : '…'

  return (
    <figure style={{ width: TILE.width }}>
      <figcaption title={name}>
        <span className='name'>{name}</span>
        <small>{status}</small>
      </figcaption>

      {/* A fixed box. The iframe inside is bigger, and gets clipped. */}
      <div
        className='tile'
        data-state={error ? 'error' : dimensions ? 'measured' : 'pending'}
        style={{ width: TILE.width, height: TILE.height }}
      >
        {error ?
          <p className='tile-error'>{error}</p>
          // The iframe keeps its own size and is drawn smaller. Never resize
          // it because a message told you a new size: `transform` does not
          // change layout, so the component cannot reflow and report again.
        : <iframe
            ref={frame}
            src={previewUrl(selection)}
            title={name}
            width={FRAME.width}
            height={FRAME.height}
            loading='lazy'
            onLoad={onLoad}
            style={{ transform: `scale(${SCALE})` }}
          />
        }
      </div>
    </figure>
  )
}

/** One fixed tile per component, the way the CMS shows them. */
export function CmsTiles() {
  return (
    <>
      <header>
        <h1>Component tiles</h1>
        <a href='?lab'>resize lab →</a>
      </header>

      <main className='grid'>
        {components.map(selection => (
          <CmsTile key={previewUrl(selection)} selection={selection} />
        ))}
      </main>
    </>
  )
}
