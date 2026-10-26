# Component preview — reference implementation

A small app that embeds component previews served by an Optimizely site, the way the CMS
will: one fixed tile per component, no modes, nothing to choose. It exists so the CMS side
has something working to copy from rather than a spec to interpret.

If you are building the CMS side, the short version is:

1. Put an iframe on the page pointing at the site's preview route.
2. Give that iframe a **fixed** size and scale it with a CSS `transform`.
3. Listen for `postMessage`: `dimensions` carries the component's size — the first one
   means it has settled, later ones mean it changed — and `error` means it could not
   render.

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
       │◀── optimizely:preview:dimensions ──────────┘
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

Resizing a frame for your own reasons — a panel dragged, a grid reflowed — is fine. That
is not a response to a message, so there is no loop to close. Send `measure` afterwards.

---

## A minimal implementation

About forty lines, and it does something [src/CmsTiles.tsx](src/CmsTiles.tsx)
deliberately does not: it **crops to the component**. The reported box and offsets move
the component into the tile's corner, and each component gets its own scale.

This app takes the simpler route instead — one frame, one constant scale, offsets
ignored — because at a frame only twice the tile's width every component already fills
most of the tile. Use the version below when your components differ a lot in size, or
when the frame is wide enough that a blind ratio would shrink a button to nothing.

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
      if (event.data?.type !== 'optimizely:preview:dimensions') return

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

**This handles sizes and nothing else.** It takes every `dimensions` message as it
comes, which is enough to render a catalogue, and deliberately skips three things that
[src/usePreview.ts](src/usePreview.ts) does handle:

| Skipped here | Why you will want it |
| --- | --- |
| A timeout, started on the frame's `load` | A site that never answers leaves the tile stuck on its guessed size, with no way to tell |
| `error` | A broken component shows an empty tile instead of saying why |
| A cap on how many updates to follow | An animating component can otherwise drive your layout forever |

`usePreview` is ~100 lines and does all three. Copy it rather than growing this example.

**This snippet is checked, not just written down.**
[e2e/snippet/index.html](e2e/snippet/index.html) is it transcribed to plain DOM, and
`node e2e/snippet-check.mjs` measures where the component lands against a real site.
Last run, against a 320-wide frame:

```text
ButtonElement      box 257×48   scale 0.665   component fills the tile exactly
HeadingElement     box 304×76   scale 0.563   component fills the tile exactly
ImageCardElement   box 304×303  scale 0.563   component fills the tile exactly
```

Three different scales for three components — that is what cropping buys you, and what
a single blind ratio cannot do.

---

## How cropping to the component works

Every component is shown in one fixed thumbnail, with no viewport switching, so nothing
ever remounts — the only thing that would have forced it is a change of layout width.

Two numbers, both constants. These are the snippet's; this app uses a frame of
342.78 × 192.81 for a tile of 171.39 × 96.41, which is the same idea with the frame
shaped like the tile:

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

Before the first measurement arrives, `box` is a guess — the frame's width and some
plausible height — so the tile shows the top of the frame scaled down. A reasonable
placeholder, and it snaps to the component when the measurement lands.

### What you still need

Even with one tile, keep these from [src/usePreview.ts](src/usePreview.ts):

- **Origin and `event.source` checks.** Unchanged — nothing about tile count affects this.
- **A timeout on the frame's `load`.** A site that never reports must fall back to a
  fixed scale rather than showing a placeholder forever.
- **`error`.** Otherwise a broken component is an empty tile with no explanation.

You can drop later measurements and the rescale cap if your tiles are fixed-height: a
late font changes the component's height, but the tile's height does not follow it, so
the worst case is slightly stale centring.

---

## Messages

Two you receive, one you send.

| Type | Direction | When | Payload |
| --- | --- | --- | --- |
| `optimizely:preview:dimensions` | child → parent | Once after fonts and images settle, then again whenever the box moves by ≥8px | `width`, `height`, `offsetX`, `offsetY`, `contentType` |
| `optimizely:preview:error` | child → parent | Could not render | `code`, `message`, `contentType` |
| `optimizely:preview:measure` | parent → child | You changed the frame's size | None |

**There is no separate `ready`.** The first `dimensions` is the readiness signal — it means
fonts have loaded, images have decoded and the layout has settled, which is what a
screenshot tool waits for. Every later one is a change. The parent does not need to be
told which is which: it is the first if nothing has arrived yet, and the payload is
identical either way, so there was nothing for two message types to carry.

### Watching the traffic

Both sides log every message while developing, and an iframe's console output lands in
the same console as the page's. In Chrome devtools, **turn the Verbose level on** — these
are `console.debug`, and the default filter hides them.

```text
[optimizely] preview → optimizely:preview:dimensions {width: 257, …}   the frame, sending
[preview] ← first ButtonElement 257×48 @ 43,72                         this app, receiving
[preview] → measure https://localhost:3000                             this app, asking
[optimizely] preview ← optimizely:preview:measure                      the frame, asked
[optimizely] preview → optimizely:preview:dimensions {…}               the frame, answering
```

Also logged, because each is otherwise an unexplained silence:

- `[optimizely] preview ✕ measure from <origin>` — the request came from an origin the
  site does not list in `parentOrigin`.
- `[preview] rejected: from <origin>` — a message arrived claiming to be this frame, from
  the wrong site.
- `[preview] rejected: bad size` — the numbers failed validation.
- `[preview] ← update ignored: past 5 updates` — the tile has stopped following this
  component.
- `[preview] nothing reported after 4000 ms` — the timeout fired.

A message from another tile's frame is dropped without a log. Every tile sees every
message, so logging those would be one line per tile per message.

Nothing in a tile grid ever resizes a frame, so there is no parent → child traffic to
watch by default. To see a full round trip, ask for one from the console:

```js
document.querySelectorAll('.tile iframe').forEach(f =>
  f.contentWindow.postMessage(
    { type: 'optimizely:preview:measure', version: 1 }, 'https://localhost:3000'))
```

Those replies count against the five-update cap, because `usePreview` only exempts the
ones it asked for itself — so after a few pokes the tiles stop following. Reload to
reset. `node e2e/protocol-check.mjs` checks the same round trip unattended.

### When you resize a frame, say so

A preview watches its own box and refits itself when that box changes, which covers a
late font or a component that reflows. Two things it cannot see:

- **A frame that only changed height.** The component's box is unchanged, so nothing
  fires — and the preview stays fitted to a frame that no longer exists.
- **A fixed-size component in a frame that changed width.** A 150px button is still
  150px; what moved is where it sits. Crop to the old `offsetX` and you frame the
  wrong region.

So post `{ type: 'optimizely:preview:measure', version: 1 }` to the frame's
`contentWindow` after you resize it, with the site's origin as `targetOrigin`. You get a
`dimensions` back whether or not anything moved. `remeasure()` from
[src/usePreview.ts](src/usePreview.ts) does this, and exempts the reply from the update
cap — an answer you asked for is not the animation that cap guards against.

The preview only accepts requests from the origins the site already lists in
`parentOrigin`. An embedder cannot name itself in either direction.

Every message carries `version: 1` and a `optimizely:preview:` prefix. Ignore types and
fields you do not recognise — that is how this stays compatible as the SDK and the CMS ship
on separate schedules.

`error.code` is one of `unknown-content-type`, `content-not-found`, `render-failed`. Treat
anything else as `render-failed`, and render `error.message` as **text, never HTML**.

---

## Which of this you actually need

Not every surface needs every message. Two, with different answers:

**A catalogue of tiles** — browsing components, fixed thumbnails, nothing resizes.

- `error` is the one that earns its place. A component that cannot preview says so
  instead of being an empty box.
- The first `dimensions` gates the skeleton, so no tile shows a half-painted component —
  and it is what a screenshot tool waits on before capturing.
- The measurement gives each component its own scale instead of one shared ratio. Weigh
  that against what it does to a grid: scaled to fit, a button looks as prominent as a
  hero band.
- Later measurements and `measure` buy you little here. Tiles are fixed, and a tile that visibly
  re-jiggles after load reads as broken. Following a handful of updates and then stopping
  is the right amount of effort.

**A component inspector** — one component, a panel, a breakpoint toggle or a draggable
frame.

- This is where the frame genuinely changes size, and where all of it matters.
- `fit: 'none'`, so the component renders at its real size and the panel scrolls.
- Send `measure` after every size change. Without it the alternative is reloading the
  frame on each toggle, which flashes and refetches.
- The breakpoint toggle only works because the frame's own size *is* the viewport inside
  it. Nothing the preview does internally can simulate a breakpoint — only the embedder
  can, by resizing the frame.

**Before scaling a catalogue up**, price the alternative. Every tile is a full page load
of the site: twenty components is twenty server renders, and a real instance has far more
content types than that. Rendering thumbnails once server-side and caching the images is
an order of magnitude cheaper and never jiggles. Live frames earn their cost when the
preview has to track settings an editor is changing right now — which is the inspector,
not the catalogue.

---

## Four things that will cost you an afternoon

1. **A white tile is probably your own CSS.** The preview document is transparent, but
   `color-scheme: light dark` on your `:root` inherits to the `<iframe>` element and makes
   the browser paint it on an opaque canvas. Set `color-scheme: normal` on the iframe.

2. **The settled signal fires once per document load.** If you change the frame's layout width, ask
   for a measurement afterwards — the component reflows by itself, but one that lands at
   the same size sends nothing, and you would sit on its old measurement forever. A
   reload works too, at the cost of a flash.

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
| [src/usePreview.ts](src/usePreview.ts) | The full listener: validation, timeout, update cap, last-good fallback. |
| [src/CmsTiles.tsx](src/CmsTiles.tsx) | The view: one fixed tile per component, scaled by one constant. |
| [src/components.ts](src/components.ts) | Which components to show, and URL building. |
| [e2e/protocol-check.mjs](e2e/protocol-check.mjs) | Drives headless Chrome and asserts components report their own box, that nothing keeps talking, and that a `measure` request is answered once. Instructions at the top of the file. |
| [e2e/snippet/](e2e/snippet/) + [e2e/snippet-check.mjs](e2e/snippet-check.mjs) | The README's minimal implementation, runnable, and a check that it frames the component exactly. |

The list in `src/components.ts` is maintained by hand, standing in for the catalogue the
CMS already holds after `optimizely-cms-cli config push`. In the CMS you would drive the
tiles from your own content type list instead.

If you depend on `@optimizely/cms-sdk`, the message types and validators are exported from
`@optimizely/cms-sdk/core` — `isPreviewMessage`, `isValidDimensions`, `PreviewMessage`.
Copying them is equally fine and is what this app does.
