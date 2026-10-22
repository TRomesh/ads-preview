import { useEffect, useRef, useState } from 'react'
import {
  isPreviewMessage,
  isValidDimensions,
  PREVIEW_MESSAGE_PREFIX,
  PreviewMessageType,
  type PreviewDimensions,
} from './protocol'

// How long to wait before deciding a preview is never going to answer.
// A site that does not use the SDK sends nothing, and must not hang the tile.
const MEASURE_TIMEOUT = 4000

// A component that animates could report a new size forever. After this many
// updates, stop listening to it and keep the last size it gave.
const MAX_UPDATES = 5

// Logs only while developing. A tile that stays blank is otherwise a mystery.
const log = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.debug('[preview]', ...args)
}

export type PreviewState = {
  /** The component's size, once it has said. Undefined until then. */
  dimensions?: PreviewDimensions
  /** The preview could not render this component. */
  error?: string
  /** Nothing arrived in time. Probably a site that does not use the SDK. */
  timedOut: boolean
  /** Put this on the iframe. It starts the timeout. */
  onLoad: () => void
}

/**
 * Listens to one preview iframe.
 *
 * You do not need this to lay the tile out: the preview fits itself to its own
 * frame, so a fixed frame scaled by a constant is enough. What you get here is
 * the component's size for display, plus the two things worth reacting to —
 * it failed, or it never answered.
 */
export function usePreview(
  frame: React.RefObject<HTMLIFrameElement | null>,
  { origin }: { origin: string },
): PreviewState {
  const [state, setState] = useState<Omit<PreviewState, 'onLoad'>>({
    timedOut: false,
  })

  // Counted for the life of the preview, not per render.
  const updates = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Started when the iframe loads, not when the tile mounts: a lazy iframe
  // below the fold is not fetched until you scroll to it, and would otherwise
  // be declared dead while it is simply waiting its turn.
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
      // Every library shares this channel, so ignore anything not ours.
      if (!isPreviewMessage(event.data)) return

      // Ours, but from another tile's iframe. Each tile sees every message,
      // so this is normal and not worth logging.
      if (event.source !== frame.current?.contentWindow) return

      // Ours, claiming to be this iframe, but from an unexpected site.
      if (event.origin !== origin) {
        log('rejected: from', event.origin, 'expected', origin)
        return
      }

      const message = event.data

      if (message.type === PreviewMessageType.error) {
        clearTimeout(timer.current)
        log('error', message.payload?.code)
        // Untrusted text. Keep it a string and render it as text, never HTML.
        setState({ error: String(message.payload?.message ?? ''), timedOut: false })
        return
      }

      // A size change after the first report. Stop following it eventually.
      if (message.type === PreviewMessageType.resize) {
        if (updates.current >= MAX_UPDATES) return
        updates.current++
      }

      // Never trust the numbers: a broken component can report anything.
      if (!isValidDimensions(message.payload)) {
        log('rejected: bad size', message.payload)
        return
      }

      const { width, height, contentType } = message.payload
      const kind = message.type.replace(PREVIEW_MESSAGE_PREFIX, '')
      log(`${kind} ${contentType} ${width}×${height}`)

      clearTimeout(timer.current)
      setState({ dimensions: message.payload, timedOut: false })
    }

    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer.current)
    }
  }, [frame, origin])

  return { ...state, onLoad }
}
