// What a preview iframe sends, what you can send it, and what to check before
// believing any of it.
//
// Written out here instead of imported from the SDK on purpose: the CMS will
// build this side from the published contract, so this app proves that works.

const PREFIX = 'optimizely:preview:'

// Bigger than any real component, small enough not to break your maths.
const MAX_DIMENSION = 20000

export type PreviewDimensions = {
  // The component's own box, not the whole preview page's.
  width: number
  height: number
  // Where that box sits in the preview, so you can frame it in a tile.
  offsetX: number
  offsetY: number
  // Which component this is, for logging and error messages.
  contentType?: string
}

export type PreviewMessage =
  // The component's box as it is now. The first one means it has settled:
  // fonts loaded, images decoded. That is the one a screenshot waits for.
  // Later ones mean it moved or changed size by 8px or more.
  | {
      type: `${typeof PREFIX}dimensions`
      version: number
      payload: PreviewDimensions
    }
  // Sent instead of a size when the component could not be rendered.
  | {
      type: `${typeof PREFIX}error`
      version: number
      payload: { code: string; message: string; contentType?: string }
    }

// Goes on every message. Ignore types and fields you do not recognise, and
// the CMS and the SDK can ship on their own schedules.
export const PREVIEW_PROTOCOL_VERSION = 1

export const PreviewMessageType = {
  dimensions: `${PREFIX}dimensions`,
  error: `${PREFIX}error`,
  // The one you send. The others, you receive.
  measure: `${PREFIX}measure`,
} as const

// Ours, or another library's? Everything on the page shares this channel.
// A shape check only — check `event.origin` for whether to trust it.
export function isPreviewMessage(data: unknown): data is PreviewMessage {
  const type = (data as PreviewMessage | undefined)?.type
  return typeof type === 'string' && type.startsWith(PREFIX)
}

// Reject bad numbers, do not clamp them: a clamped value looks real, and you
// would keep it as the last good size.
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
