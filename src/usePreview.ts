import { useEffect, useRef, useState } from 'react'
import {
  isPreviewMessage,
  isValidDimensions,
  PREVIEW_PROTOCOL_VERSION,
  PreviewMessageType,
  type PreviewDimensions,
} from './protocol'

// Give up waiting after this. A site that does not use the SDK never answers,
// and the tile must not sit there forever.
const MEASURE_TIMEOUT = 4000

// An animating component could report a new size forever. Follow this many
// changes, then keep the last size it gave.
const MAX_UPDATES = 5

// Dev only. Without it, a blank tile has no explanation.
const log = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.debug('[preview]', ...args)
}

export type PreviewState = {
  /** The component's size. Undefined until the preview reports it. */
  dimensions?: PreviewDimensions
  /** Set when the preview could not render the component. */
  error?: string
  /** Nothing arrived in time. Usually a site that does not use the SDK. */
  timedOut: boolean
  /** Pass to the iframe's `onLoad`. Starts the timeout. */
  onLoad: () => void
  /**
   * Ask the preview to measure itself again. Call it after you resize the
   * frame: the preview only watches its own box, so a frame that changed
   * height, or a fixed-size component recentred by a width change, reports
   * nothing on its own.
   */
  remeasure: () => void
}

/**
 * Listens to one preview iframe.
 *
 * The preview fits itself to its frame, so you do not need this to lay the
 * tile out. What it adds is the component's size, plus the two things you do
 * have to react to: it failed, or it never answered.
 */
export function usePreview(
  frame: React.RefObject<HTMLIFrameElement | null>,
  { origin }: { origin: string },
): PreviewState {
  const [state, setState] = useState<
    Omit<PreviewState, 'onLoad' | 'remeasure'>
  >({ timedOut: false })

  // Refs, not state: these change without anything needing to re-render.
  const updates = useRef(0) // how many changes we have followed
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const asked = useRef(false) // a reply we requested is on its way
  const measured = useRef(false) // the first measurement has arrived

  const remeasure = () => {
    asked.current = true
    log('→ measure', origin)
    frame.current?.contentWindow?.postMessage(
      { type: PreviewMessageType.measure, version: PREVIEW_PROTOCOL_VERSION },
      origin,
    )
  }

  // Start the clock when the iframe loads, not when the tile mounts. A lazy
  // iframe below the fold is not fetched until you scroll to it, and would
  // otherwise be called dead while it is only waiting its turn.
  const onLoad = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      log('nothing reported after', MEASURE_TIMEOUT, 'ms')
      setState(current =>
        current.dimensions ? current : { ...current, timedOut: true },
      )
    }, MEASURE_TIMEOUT)
  }

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Every library on the page shares this channel. Ignore what is not ours.
      if (!isPreviewMessage(event.data)) return

      // Ours, but from another tile's iframe. Every tile sees every message,
      // so this is normal — not worth logging.
      if (event.source !== frame.current?.contentWindow) return

      // Claims to be our frame, but came from somewhere else.
      if (event.origin !== origin) {
        log('rejected: from', event.origin, 'expected', origin)
        return
      }

      const message = event.data

      if (message.type === PreviewMessageType.error) {
        clearTimeout(timer.current)
        log('← error', message.payload?.code)
        // Untrusted text. Keep it a string and render it as text, never HTML.
        setState({ error: String(message.payload?.message ?? ''), timedOut: false })
        return
      }

      // One message type covers both cases, so which one this is comes from
      // what has already arrived. The first means the component is ready.
      // Later ones mean it changed, and we follow only a few of those.
      if (measured.current) {
        // A reply we asked for is not the animation the cap guards against.
        if (asked.current) asked.current = false
        else if (updates.current >= MAX_UPDATES) {
          // Say so. A tile that stopped following a component looks exactly
          // like one whose component stopped reporting.
          log('← update ignored: past', MAX_UPDATES, 'updates')
          return
        } else updates.current++
      }

      // Never trust the numbers. A broken component can report anything.
      if (!isValidDimensions(message.payload)) {
        log('rejected: bad size', message.payload)
        return
      }

      const { width, height, offsetX, offsetY, contentType } = message.payload
      const kind = measured.current ? 'update' : 'first'
      log(`← ${kind} ${contentType} ${width}×${height} @ ${offsetX},${offsetY}`)

      measured.current = true
      clearTimeout(timer.current)
      setState({ dimensions: message.payload, timedOut: false })
    }

    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer.current)
    }
  }, [frame, origin])

  return { ...state, onLoad, remeasure }
}
