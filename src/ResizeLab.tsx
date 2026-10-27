import { useEffect, useRef, useState } from 'react'
import { components, origin, previewUrl } from './components'
import { isPreviewMessage, PREVIEW_PROTOCOL_VERSION, PreviewMessageType } from './protocol'
import './App.css'

// A frame you can resize, and a log of everything the preview says about it.
//
// The tile grid never changes a frame's size, so none of the resize paths
// show up there. This is where you watch them.
//
// It listens to the raw messages rather than going through `usePreview`, so
// nothing is filtered: you see the updates the cap would have dropped too.

const previewOrigin = new URL(origin).origin

const START = { width: 343, height: 193 }

export function ResizeLab() {
  const frame = useRef<HTMLIFrameElement>(null)
  const [size, setSize] = useState(START)
  const [selected, setSelected] = useState(0)
  const [lines, setLines] = useState<string[]>([])

  const selection = components[selected]

  const say = (line: string) =>
    setLines(current => [...current, `${new Date().toLocaleTimeString()}  ${line}`])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!isPreviewMessage(event.data)) return
      if (event.source !== frame.current?.contentWindow) return
      if (event.origin !== previewOrigin) return

      const message = event.data
      if (message.type === PreviewMessageType.error) {
        say(`error  ${message.payload.code}: ${message.payload.message}`)
        return
      }

      const { width, height, offsetX, offsetY } = message.payload
      say(`dimensions  ${width}×${height} @ ${offsetX},${offsetY}`)
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Changing the attributes really resizes the frame, so the viewport inside
  // changes with it. A CSS transform would not: it only changes how the frame
  // is painted, which is the whole reason tiles use one.
  const resize = (next: Partial<typeof START>) =>
    setSize(current => ({ ...current, ...next }))

  const measure = () => {
    say('→ measure')
    frame.current?.contentWindow?.postMessage(
      { type: PreviewMessageType.measure, version: PREVIEW_PROTOCOL_VERSION },
      previewOrigin,
    )
  }

  return (
    <>
      <header>
        <h1>Resize lab</h1>
        <a href='?'>← tiles</a>
      </header>

      <main className='lab'>
        <div className='lab-controls'>
          <label>
            component
            <select
              value={selected}
              onChange={event => {
                setLines([])
                setSelected(Number(event.target.value))
              }}
            >
              {components.map((option, index) => (
                <option key={previewUrl(option)} value={index}>
                  {[option.contentType, option.displayTemplate]
                    .filter(Boolean)
                    .join(' · ')}
                  {option.settings ? ` · ${Object.values(option.settings)}` : ''}
                </option>
              ))}
            </select>
          </label>

          <label>
            width <output>{size.width}px</output>
            <input
              id='w'
              type='range'
              min={160}
              max={1280}
              value={size.width}
              onInput={event => resize({ width: Number(event.currentTarget.value) })}
              onChange={() => {}}
            />
          </label>

          <label>
            height <output>{size.height}px</output>
            <input
              id='h'
              type='range'
              min={80}
              max={1200}
              value={size.height}
              onInput={event => resize({ height: Number(event.currentTarget.value) })}
              onChange={() => {}}
            />
          </label>

          <div className='lab-buttons'>
            <button id='measure' onClick={measure}>
              Send measure
            </button>
            <button id='clear' onClick={() => setLines([])}>
              Clear log
            </button>
          </div>

          <p className='lab-hint'>
            The preview centres the component, so most size changes move it and
            get reported. Silence means nothing moved by 8px or more — that is
            what <code>measure</code> is for.
          </p>

          <pre id='log' className='lab-log'>
            {lines.join('\n')}
          </pre>
        </div>

        <iframe
          ref={frame}
          // Remounts when the component changes, so each one reports afresh.
          key={previewUrl(selection)}
          src={previewUrl(selection)}
          title='preview'
          width={size.width}
          height={size.height}
          className='lab-frame'
        />
      </main>
    </>
  )
}
