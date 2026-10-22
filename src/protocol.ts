// What a preview iframe sends, and what to check before believing it.
// Declared here rather than imported from the SDK: the CMS will implement this
// side from the published contract, so this app proves that is possible.

const PREFIX = 'optimizely:preview:'

// Exported so a caller can strip it when logging a message type.
export const PREVIEW_MESSAGE_PREFIX = PREFIX

// Past any real component, short of breaking layout arithmetic.
const MAX_DIMENSION = 20000

export type PreviewDimensions = {
  // The component's own box, not the preview page's.
  width: number
  height: number
  // Where that box sits inside the preview, so a tile can frame it.
  offsetX: number
  offsetY: number
  // The layout width it was measured at.
  viewportWidth: number
  element: string
  contentType?: string
}

export type PreviewMessage =
  // Sent once, when fonts, images and layout have settled.
  | { type: `${typeof PREFIX}ready`; version: number; payload: PreviewDimensions }
  // Sent after `ready` if the component changed size by 8px or more.
  | {
      type: `${typeof PREFIX}resize`
      version: number
      payload: PreviewDimensions & { previousHeight: number }
    }
  // Sent instead of a measurement when the preview could not render.
  | {
      type: `${typeof PREFIX}error`
      version: number
      payload: { code: string; message: string; contentType?: string }
    }

export const PreviewMessageType = {
  ready: `${PREFIX}ready`,
  resize: `${PREFIX}resize`,
  error: `${PREFIX}error`,
} as const

// Ours or someone else's? The message channel is shared with every library.
export function isPreviewMessage(data: unknown): data is PreviewMessage {
  const type = (data as PreviewMessage | undefined)?.type
  return typeof type === 'string' && type.startsWith(PREFIX)
}

// Rejected rather than clamped: a clamped bogus value looks like a real one.
export function isValidDimensions(value: unknown): value is PreviewDimensions {
  const { width, height } = (value ?? {}) as PreviewDimensions

  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_DIMENSION &&
    height <= MAX_DIMENSION
  )
}
