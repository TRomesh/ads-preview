import { useEffect, useRef, useState } from 'react'
import {
  isPreviewMessage,
  isValidDimensions,
  PreviewMessageType,
  type PreviewDimensions,
} from './protocol'

// Give up after this, so a preview that never speaks does not hang a tile.
const MEASURE_TIMEOUT = 4000

// Stop reacting after this many resizes, so an animating component settles.
const MAX_RESCALES = 5

// Shape assumed until a preview reports, and for previews that never do.
const FALLBACK_ASPECT = 16 / 9

export type PreviewState = {
  dimensions: PreviewDimensions
  // False until the preview reports, or until it times out.
  measured: boolean
  // The preview said it could not render.
  error?: string
  // Nothing arrived in time — probably not an SDK preview.
  timedOut: boolean
}

// Listens to one preview iframe and reports what it says about its size.
// Nothing here resizes the frame: the caller scales with a CSS transform, so a
// component cannot reflow from being scaled and re-report forever.
// A different reference width is a different preview — remount, do not update.
export function usePreview(
  frame: React.RefObject<HTMLIFrameElement | null>,
  { origin, referenceWidth }: { origin: string; referenceWidth: number },
) {
  const [state, setState] = useState<PreviewState>(() => ({
    dimensions: {
      width: referenceWidth,
      height: Math.round(referenceWidth / FALLBACK_ASPECT),
      offsetX: 0,
      offsetY: 0,
      viewportWidth: referenceWidth,
      element: '',
    },
    measured: false,
    timedOut: false,
  }))

  // Counted across the preview's life, not per render.
  const rescales = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Started on `load`, not on mount: a lazy tile below the fold has not been
  // fetched yet and would otherwise time out while waiting its turn.
  const onLoad = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(
      () =>
        setState(current => (current.measured ? current : { ...current, timedOut: true })),
      MEASURE_TIMEOUT,
    )
  }

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Origin says which site; source says which frame. Both, not either.
      if (event.origin !== origin) return
      if (event.source !== frame.current?.contentWindow) return
      if (!isPreviewMessage(event.data)) return

      const message = event.data

      if (message.type === PreviewMessageType.error) {
        clearTimeout(timer.current)
        // Untrusted text: kept as a string, rendered as text, never markup.
        setState(current => ({ ...current, error: String(message.payload?.message ?? '') }))
        return
      }

      // Past the cap, keep the last good size rather than following the frame.
      if (message.type === PreviewMessageType.resize) {
        if (rescales.current >= MAX_RESCALES) return
        rescales.current++
      }

      if (!isValidDimensions(message.payload)) return

      clearTimeout(timer.current)
      setState({
        dimensions: message.payload,
        measured: true,
        timedOut: false,
        error: undefined,
      })
    }

    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer.current)
    }
  }, [frame, origin])

  return { ...state, onLoad }
}
