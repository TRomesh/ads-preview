import { useRef, useState } from 'react'
import { components, origin, previewUrl, type Selection } from './components'
import { usePreview, type PreviewState } from './usePreview'
import './App.css'

// The width the component is laid out at. Changing it is a different preview.
const LAYOUT_WIDTHS = { mobile: 375, tablet: 768, desktop: 1280 } as const

// The width the tile is displayed at. Changing it only changes a CSS scale.
const TILE_WIDTHS = { thumbnail: 171.391, small: 320, medium: 480 } as const

// Fixed too, so a `vh`-sized component measures against a stable box.
const LAYOUT_HEIGHT = 720

type LayoutWidth = keyof typeof LAYOUT_WIDTHS
type TileWidth = keyof typeof TILE_WIDTHS

const previewOrigin = new URL(origin).origin

// `HeadingElement · HeadingStyles · level: h3`
function label({ contentType, displayTemplate, settings }: Selection) {
  const applied = Object.entries(settings ?? {})
    .map(([setting, value]) => `${setting}: ${value}`)
    .join(', ')

  return [contentType, displayTemplate, applied].filter(Boolean).join(' · ')
}

// How to show a component's box, reported in page coordinates, inside a tile.
function fitIntoTile(dimensions: PreviewState['dimensions'], tileWidth: number) {
  // Capped at 1: upscaling past native blurs rather than helps.
  const scale = Math.min(1, tileWidth / dimensions.width)

  // Whatever the component does not use across the tile becomes centring.
  const slack = Math.max(0, (tileWidth - dimensions.width * scale) / 2)

  return {
    height: Math.max(1, dimensions.height * scale),
    // Read right to left: move the component's box to the frame's corner,
    // scale it down, then nudge it to the middle of the tile.
    transform:
      `translateX(${slack}px) scale(${scale}) ` +
      `translate(${-dimensions.offsetX}px, ${-dimensions.offsetY}px)`,
  }
}

function Tile({
  selection,
  layoutWidth,
  tileWidth,
}: {
  selection: Selection
  layoutWidth: number
  tileWidth: number
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const { dimensions, measured, error, timedOut, onLoad } = usePreview(frame, {
    origin: previewOrigin,
    referenceWidth: layoutWidth,
  })

  const { height, transform } = fitIntoTile(dimensions, tileWidth)
  const name = label(selection)

  const status =
    error ? 'error'
    : timedOut ? 'unmeasured'
    : measured ? `${Math.round(dimensions.width)}×${Math.round(dimensions.height)}`
    : '…'

  return (
    <figure style={{ width: tileWidth }}>
      <figcaption>
        {name}
        <small>{status}</small>
      </figcaption>

      {/* Clips the frame's full layout box down to the component. */}
      <div
        className='tile'
        data-state={error ? 'error' : measured ? 'measured' : 'pending'}
        style={{ width: tileWidth, height }}
      >
        {error ?
          <p className='tile-error'>{error}</p>
          // Sized by its attributes, scaled by transform. The attributes never
          // change, which is what stops the component reflowing when scaled.
        : <iframe
            ref={frame}
            src={previewUrl(selection)}
            title={name}
            width={layoutWidth}
            height={LAYOUT_HEIGHT}
            loading='lazy'
            onLoad={onLoad}
            style={{ transform }}
          />
        }
      </div>
    </figure>
  )
}

function Toggle<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: Record<T, number>
  value: T
  onChange: (next: T) => void
}) {
  return (
    <div className='viewports' role='group' aria-label={label}>
      <span className='toggle-label'>{label}</span>
      {Object.entries(options).map(([name, width]) => (
        <button
          key={name}
          type='button'
          aria-pressed={value === name}
          onClick={() => onChange(name as T)}
        >
          {name} <small>{Math.round(width as number)}</small>
        </button>
      ))}
    </div>
  )
}

function App() {
  const [layout, setLayout] = useState<LayoutWidth>('desktop')
  const [tile, setTile] = useState<TileWidth>('small')

  return (
    <>
      <header>
        <h1>Component preview</h1>
        <div className='controls'>
          <Toggle
            label='Layout'
            options={LAYOUT_WIDTHS}
            value={layout}
            onChange={setLayout}
          />
          <Toggle label='Tile' options={TILE_WIDTHS} value={tile} onChange={setTile} />
        </div>
      </header>

      <main className='grid'>
        {components.map(selection => (
          // Keyed by layout width too: that reloads the frame, and a preview
          // only reports once per load.
          <Tile
            key={`${previewUrl(selection)}@${LAYOUT_WIDTHS[layout]}`}
            selection={selection}
            layoutWidth={LAYOUT_WIDTHS[layout]}
            tileWidth={TILE_WIDTHS[tile]}
          />
        ))}
      </main>
    </>
  )
}

export default App
