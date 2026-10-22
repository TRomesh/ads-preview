# Component preview — reference implementation

A small app that embeds component previews served by an Optimizely site, the way the CMS
will: one fixed tile per component, no modes, nothing to choose. It exists so the CMS side
has something working to copy from rather than a spec to interpret.

If you are building the CMS side, the short version is:

1. Put an iframe on the page pointing at the site's preview route.
2. Give that iframe a **fixed** size and scale it with a CSS `transform`.
3. Listen for `postMessage`: one `ready` with the component's size, then `resize` if it
   changes and `error` if it could not render.

Everything else here is detail around those three steps.

---

## Run it

Two things have to be running. The site that renders the components:

```bash
cd ../content-js-sdk/templates/stride
pnpm dev                       # https://localhost:3000
```

Open `https://localhost:3000` once in a browser and accept the self-signed certificate, or
every frame stays blank.

The template consumes the SDK from `dist`, so run `pnpm build` in
`packages/optimizely-cms-sdk` after changing SDK code or switching branches. A stale build
shows up as `500` on the preview route and `unmeasured` on every tile.

Then this app:

```bash
pnpm install
pnpm dev                       # http://localhost:5173, or 5174 if that is taken
```

Point it at a different site with `VITE_PREVIEW_ORIGIN=https://my-site.example pnpm dev`.

### The site must name you

A preview only reports its size to origins the **site** has configured — an embedder
cannot ask to be told. In the Stride template that is `OPTIMIZELY_CMS_URL` (trusted
automatically) plus anything in `PREVIEW_PARENT_ORIGIN`:

```sh
# templates/stride/.env
PREVIEW_PARENT_ORIGIN=http://localhost:5173
```

Without it the previews render but report nothing, and every tile shows `unmeasured`
after four seconds. The SDK logs a warning in the frame's console when this happens.

---

## The URL you embed

```text
https://site.example.com/preview/component
  ?contentType=HeadingElement        which component
  &displayTemplate=HeadingStyles     optional: render through a display template
  &level=h3                          optional: any display setting, by name
  &locale=en                         optional
```

| Parameter | Renders |
| --- | --- |
| `contentType=<key>` | Generated stand-in content, derived from the content type's schema. Works before any editor has created content — use this for a catalogue. |
| `key=<content key>` | A real, published content item. |

**Any other parameter becomes a display setting.** That is how you show variants: one URL
per tile.

```text
?contentType=ButtonElement&displayTemplate=ButtonStyles&variant=primary
?contentType=HeadingElement&displayTemplate=HeadingStyles&level=h3&icon=globe
```

Naming the display template matters. With it, the site applies the template's tag and the
defaults for its other settings — what an editor would see. Passing a bare setting without
the template only overrides that one value.

`previewUrl()` in [src/components.ts](src/components.ts) builds these.

---

## How the sizing works

The parent cannot measure across origins, and components differ wildly — a hero band fills
the page, a button is 257×48. So the preview measures itself and tells you.

```text
  YOUR PAGE                               THE SITE'S PREVIEW ROUTE
  ─────────                               ────────────────────────
  iframe 320 × 1600 ───── GET ─────────▶ render the component alone
       │                                  wait for fonts and images
       │                                  measure the component's box
       │                                          │
       │◀── optimizely:preview:ready ─────────────┘
       │    { width: 257, height: 48,
       │      offsetX: 511, offsetY: 336 }
       │
  scale = tileWidth / 257
  transform: translate(-offsetX,-offsetY) then scale
```

`width`/`height` are the **component's** box, not the page's. `offsetX`/`offsetY` say
where it sits inside the page, so you can move it into the corner of your tile before
scaling — otherwise you frame the empty space around it.

**Make the frame tall enough.** A frame cannot show content past its own height, so a
component taller than the frame is cropped however you scale it — and if you size the
tile from the reported height, the extra becomes empty space the frame cannot fill. 1600
contains the cards in this set; clamp the fit to the frame height for anything taller.

**The frame's width decides how readable the text is.** Text is scaled by
`tileWidth / layoutWidth`, so a component laid out at 1280 shrinks 7.5× into a 171px tile
and 36px type lands at 5px — you see shape, not words. At 320 the shrink is 0.54 and the
text reads properly, at the cost of components rendering their narrow layout. Pick
whichever matters more; it is one constant.

**Give the tile a background.** The preview document is transparent, and components are
usually designed for a light page. Without `background: #fff` on the tile, dark text sits
on your own background and disappears.

### The one rule

**Never resize the iframe in response to a message.** Keep its `width`/`height` attributes
fixed and scale with `transform`.

`transform` is paint-only and does not change layout width, so the component cannot reflow
because you scaled it, and so cannot report a new size. If you resize the frame instead, a
responsive component crossing a breakpoint reports a different height, you resize again,
and it never settles.

---

## A minimal implementation

[src/CmsTiles.tsx](src/CmsTiles.tsx) is the whole view. Stripped of this app's styling,
a fixed desktop preview is about forty lines:

```tsx
import { useEffect, useRef, useState } from 'react'

const LAYOUT_WIDTH = 320     // never changes
const LAYOUT_HEIGHT = 1600   // tall enough to contain a card in full
const SITE = 'https://site.example.com'

function PreviewTile({ contentType, tileWidth }: { contentType: string; tileWidth: number }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [box, setBox] = useState({ width: LAYOUT_WIDTH, height: 720, offsetX: 0, offsetY: 0 })

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== new URL(SITE).origin) return          // which site
      if (event.source !== frame.current?.contentWindow) return  // which frame
      if (event.data?.type !== 'optimizely:preview:ready') return

      const { width, height, offsetX, offsetY } = event.data.payload
      if (!Number.isFinite(width) || width <= 0 || width > 20000) return
      if (!Number.isFinite(height) || height <= 0 || height > 20000) return

      setBox({ width, height, offsetX, offsetY })
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const scale = Math.min(1, tileWidth / box.width)

  return (
    <div
      style={{ width: tileWidth, height: box.height * scale, overflow: 'hidden' }}
    >
      <iframe
        ref={frame}
        src={`${SITE}/preview/component?contentType=${contentType}`}
        width={LAYOUT_WIDTH}
        height={LAYOUT_HEIGHT}
        style={{
          border: 0,
          colorScheme: 'normal',
          transformOrigin: 'top left',
          transform: `scale(${scale}) translate(${-box.offsetX}px, ${-box.offsetY}px)`,
        }}
      />
    </div>
  )
}
```

**This handles `ready` only.** It is enough to render a catalogue, and deliberately
skips four things that [src/usePreview.ts](src/usePreview.ts) does handle:

| Skipped here | Why you will want it |
| --- | --- |
| A timeout, started on the frame's `load` | A site that never reports leaves the tile stuck on its guessed size, with no way to tell |
| `resize` | A late web font or lazily decoded image changes the height after `ready` |
| `error` | A broken component shows an empty tile instead of saying why |
| A cap on how many resizes to follow | An animating component can otherwise drive your layout indefinitely |

`usePreview` is ~100 lines and does all four. Copy it rather than growing this example.

---

## How the fixed tile works

Every component is shown in one fixed thumbnail, with no viewport switching, so nothing
ever remounts — the only thing that would have forced it is a change of layout width.

Two numbers, both constants:

```text
LAYOUT   320 × 1600  the viewport the component is laid out and measured in. Never changes.
TILE     171 × 96    your thumbnail. Also never changes.
```

Fit the reported box inside the tile and centre it:

```tsx
// Never upscale: a 48px button blown up to fill a tile just looks blurry.
const scale = Math.min(1, TILE.width / box.width, TILE.height / box.height)

const left = (TILE.width - box.width * scale) / 2
const top = (TILE.height - box.height * scale) / 2

// Right to left: component box to the frame's corner, scale it, then centre.
const transform =
  `translate(${left}px, ${top}px) scale(${scale}) ` +
  `translate(${-box.offsetX}px, ${-box.offsetY}px)`
```

Before the measurement arrives, `box` is the whole 1280×720 viewport, so the tile shows the
page scaled down — a reasonable placeholder that sharpens into the component when `ready`
lands.

### Could you skip the protocol entirely?

Almost. The preview page centres the component in its viewport already, so scaling the
whole frame by `tileWidth / 1280` gives you a centred, uncropped thumbnail with no
messages at all.

The catch is scale. That fixed ratio is 0.1875 for a 240px tile, which is right for a hero
band and useless for a button — it becomes a 48px smudge. The measurement is what lets a
small component be shown at or near its own size while a large one is scaled to fit. If
every component you preview is page-sized, blind scaling genuinely is enough.

### What you still need

Even with one tile, keep these from [src/usePreview.ts](src/usePreview.ts):

- **Origin and `event.source` checks.** Unchanged — nothing about tile count affects this.
- **A timeout on the frame's `load`.** A site that never reports must fall back to the
  blind scale above rather than showing a placeholder forever.
- **`error`.** Otherwise a broken component is an empty tile with no explanation.

You can drop `resize` handling and the rescale cap if your tiles are fixed-height: a
late font changes the component's height, but the tile's height does not follow it, so
the worst case is slightly stale centring.

---

## Messages

All are child → parent. You never send anything.

| Type | When | Payload |
| --- | --- | --- |
| `optimizely:preview:ready` | Once, after fonts and images settle | `width`, `height`, `offsetX`, `offsetY`, `viewportWidth`, `element`, `contentType` |
| `optimizely:preview:resize` | Size changed by ≥8px after `ready` | Same, plus `previousHeight` |
| `optimizely:preview:error` | Could not render | `code`, `message`, `contentType` |

Every message carries `version: 1` and a `optimizely:preview:` prefix. Ignore types and
fields you do not recognise — that is how this stays compatible as the SDK and the CMS ship
on separate schedules.

`error.code` is one of `unknown-content-type`, `content-not-found`, `render-failed`. Treat
anything else as `render-failed`, and render `error.message` as **text, never HTML**.

---

## Four things that will cost you an afternoon

1. **A white tile is probably your own CSS.** The preview document is transparent, but
   `color-scheme: light dark` on your `:root` inherits to the `<iframe>` element and makes
   the browser paint it on an opaque canvas. Set `color-scheme: normal` on the iframe.

2. **`ready` fires once per document load.** If you ever change the frame's layout width,
   reload it — remount the element or change `src`. A component that is the same height at
   both widths sends no `resize`, so it would sit on its old measurement forever.

3. **Start any timeout on the frame's `load` event, not on mount.** With `loading="lazy"`,
   a frame below the fold has not been fetched yet and would otherwise be declared dead
   while waiting its turn.

4. **Validate `event.source`, not just `event.origin`.** Any document from the site's
   origin can post, including another preview tile. The source check is what ties a
   measurement to the frame it describes.

---

## What is in here

| Path | |
| --- | --- |
| [src/protocol.ts](src/protocol.ts) | Message types and both validators. Written without importing the SDK, deliberately — the same position you are in. |
| [src/usePreview.ts](src/usePreview.ts) | The full listener: validation, timeout, resize cap, last-good fallback. |
| [src/CmsTiles.tsx](src/CmsTiles.tsx) | The view: one fixed tile per component, and the transform maths. |
| [src/components.ts](src/components.ts) | Which components to show, and URL building. |
| [e2e/protocol-check.mjs](e2e/protocol-check.mjs) | Drives headless Chrome and asserts components report their own box and that re-scaling emits nothing. Instructions at the top of the file. |

The list in `src/components.ts` is maintained by hand, standing in for the catalogue the
CMS already holds after `optimizely-cms-cli config push`. In the CMS you would drive the
tiles from your own content type list instead.

If you depend on `@optimizely/cms-sdk`, the message types and validators are exported from
`@optimizely/cms-sdk/core` — `isPreviewMessage`, `isValidDimensions`, `PreviewMessage`.
Copying them is equally fine and is what this app does.
