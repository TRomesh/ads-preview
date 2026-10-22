import { useRef } from 'react'
import { components, origin, previewUrl, type Selection } from './components'
import { usePreview, type PreviewState } from './usePreview'
import './App.css'

// The viewport every component is laid out and measured in. Never changes.
const LAYOUT = { width: 1280, height: 720 }

// The thumbnail every component is shown in. Also never changes.
const TILE = { width: 320, height: 180 }

const previewOrigin = new URL(origin).origin

// `HeadingElement · HeadingStyles · level: h3`
function label({ contentType, displayTemplate, settings }: Selection) {
  const applied = Object.entries(settings ?? {})
    .map(([setting, value]) => `${setting}: ${value}`)
    .join(', ')

  return [contentType, displayTemplate, applied].filter(Boolean).join(' · ')
}

// Fit the reported box inside the tile and centre it on both axes.
function containInTile(box: PreviewState['dimensions']) {
  // Never upscale: a 48px button blown up to fill a tile only looks blurry.
  const scale = Math.min(1, TILE.width / box.width, TILE.height / box.height)

  const left = (TILE.width - box.width * scale) / 2
  const top = (TILE.height - box.height * scale) / 2

  // Right to left: component box to the frame's corner, scale, then centre.
  return (
    `translate(${left}px, ${top}px) scale(${scale}) ` +
    `translate(${-box.offsetX}px, ${-box.offsetY}px)`
  )
}

function CmsTile({ selection }: { selection: Selection }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const { dimensions, measured, error, timedOut, onLoad } = usePreview(frame, {
    origin: previewOrigin,
    referenceWidth: LAYOUT.width,
  })

  const name = label(selection)

  return (
    <figure style={{ width: TILE.width }}>
      <figcaption>
        {name}
        <small>
          {error ? 'error'
          : timedOut ? 'unmeasured'
          : measured ?
            `${Math.round(dimensions.width)}×${Math.round(dimensions.height)}`
          : '…'}
        </small>
      </figcaption>

      {/* Fixed box. The frame inside it is larger and clipped. */}
      <div
        className='tile'
        data-state={error ? 'error' : measured ? 'measured' : 'pending'}
        style={{ width: TILE.width, height: TILE.height }}
      >
        {error ?
          <p className='tile-error'>{error}</p>
        : <iframe
            ref={frame}
            src={previewUrl(selection)}
            title={name}
            width={LAYOUT.width}
            height={LAYOUT.height}
            loading='lazy'
            onLoad={onLoad}
            style={{ transform: containInTile(dimensions) }}
          />
        }
      </div>
    </figure>
  )
}

/**
 * One fixed tile per component, the way the CMS shows them: no viewport modes,
 * no tile sizes, nothing to choose. The protocol is unchanged — each preview
 * still reports its size, which is what lets a button be shown near its own
 * size while a hero band is scaled down to fit.
 */
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
