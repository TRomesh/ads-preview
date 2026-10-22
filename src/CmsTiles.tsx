import { useRef } from 'react'
import { components, origin, previewUrl, type Selection } from './components'
import { usePreview } from './usePreview'
import './App.css'

// The size the iframe is given. The site lays the component out at this width
// and shrinks it to fit this box, so whatever the component is, the whole of
// it ends up inside the frame.
//
// Narrow on purpose. Text in a tile ends up at `tile / frame` of its real
// size, so a component laid out at 1280 would put 36px type at 5px. At 320 it
// can be read. The cost is that components render their narrow layout.
const FRAME = { width: 320, height: 180 }

// The size the tile is shown at. Same shape as the frame, so the tile is just
// the frame scaled down — one constant, no per-component maths.
const TILE = { width: 171.391, height: 96.406 }
const SCALE = TILE.width / FRAME.width

// Messages are only accepted from here. `origin` may include a path; this is
// the bare origin that `event.origin` is compared against.
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

  // None of this affects the layout — the tile is a fixed box either way.
  // It is what the caption says and how the tile is styled.
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

      {/* A fixed box. The iframe inside it is bigger and gets clipped. */}
      <div
        className='tile'
        data-state={error ? 'error' : dimensions ? 'measured' : 'pending'}
        style={{ width: TILE.width, height: TILE.height }}
      >
        {error ?
          <p className='tile-error'>{error}</p>
          // The iframe keeps its own size and is scaled down into the tile.
          // Never resize it in response to a message: a transform does not
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
      </header>

      <main className='grid'>
        {components.map(selection => (
          <CmsTile key={previewUrl(selection)} selection={selection} />
        ))}
      </main>
    </>
  )
}
