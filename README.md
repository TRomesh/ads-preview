# Component preview — reference implementation

A small app that embeds component previews served by an Optimizely site, the way the CMS
will. It exists so the CMS side has something working to copy from rather than a spec to
interpret.

If you are building the CMS side, the short version is:

1. Put an iframe on the page pointing at the site's preview route.
2. Give that iframe a **fixed** size and scale it with a CSS `transform`.
3. Listen for one `postMessage` telling you how big the component actually is.

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

Then this app:

```bash
pnpm install
pnpm dev                       # http://localhost:5173
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
  iframe width=1280 height=720 ── GET ──▶ render the component alone
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
where it sits inside the 1280×720 page, so you can move it into the corner of your tile
before scaling — otherwise you frame the empty space around it.

### The one rule

**Never resize the iframe in response to a message.** Keep its `width`/`height` attributes
fixed and scale with `transform`.

`transform` is paint-only and does not change layout width, so the component cannot reflow
because you scaled it, and so cannot report a new size. If you resize the frame instead, a
responsive component crossing a breakpoint reports a different height, you resize again,
and it never settles.

---

## Desktop only: the whole thing

You do not need the mobile/tablet switching this app has. For a fixed desktop preview the
component is about forty lines:

```tsx
import { useEffect, useRef, useState } from 'react'

const LAYOUT_WIDTH = 1280   // never changes
const LAYOUT_HEIGHT = 720
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

That is enough for a catalogue. The extra machinery in [src/usePreview.ts](src/usePreview.ts)
handles the cases this skips: a timeout for sites that never report, `resize` for content
that changes after load, `error` for components that fail to render, and a cap so an
animating component cannot drive your layout forever. Copy it when you need those.

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
| [src/App.tsx](src/App.tsx) | Tile rendering and the transform maths. |
| [src/components.ts](src/components.ts) | Which components to show, and URL building. |
| [e2e/protocol-check.mjs](e2e/protocol-check.mjs) | Drives headless Chrome and asserts components report their own box and that re-scaling emits nothing. Instructions at the top of the file. |

The list in `src/components.ts` is maintained by hand, standing in for the catalogue the
CMS already holds after `optimizely-cms-cli config push`. In the CMS you would drive the
tiles from your own content type list instead.

If you depend on `@optimizely/cms-sdk`, the message types and validators are exported from
`@optimizely/cms-sdk/core` — `isPreviewMessage`, `isValidDimensions`, `PreviewMessage`.
Copying them is equally fine and is what this app does.
