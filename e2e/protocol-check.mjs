/**
 * End-to-end check for the preview protocol.
 *
 * jsdom cannot prove any of this: there is no layout, so a measurement is
 * whatever the test stubs say. This drives a real browser and asserts the two
 * properties the design rests on.
 *
 *   1. A preview reports its *component's* box, not the page's. Components
 *      differ in size, and one narrower than the frame proves the measurement
 *      is of the component rather than the wrapper around it.
 *   2. Nothing keeps talking. After the previews settle, no further protocol
 *      messages arrive — the parent scales with a CSS transform, so a
 *      component cannot reflow from being scaled and re-report forever.
 *   3. A measure request is answered, exactly once. This is the only message
 *      that travels parent → child, and the only way an embedder that resized
 *      a frame can get a fresh measurement out of it.
 *
 * Needs three things running:
 *
 *   cd content-js-sdk/packages/optimizely-cms-sdk && pnpm build
 *   cd content-js-sdk/templates/stride && pnpm dev
 *   cd ads-preview && pnpm dev
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     --headless=new --remote-debugging-port=9222 --ignore-certificate-errors \
 *     --user-data-dir=/tmp/preview-e2e about:blank
 *
 * Then: node e2e/protocol-check.mjs http://localhost:5173
 */

const APP_URL = process.argv[2] ?? 'http://localhost:5173';
const CDP = 'http://127.0.0.1:9222';

// How long to watch for stray messages once the previews have settled.
const QUIET_PERIOD = 4000;

const targets = await (await fetch(`${CDP}/json/list`)).json();
const target = targets.find(t => t.type === 'page');
if (!target)
  throw new Error('No Chrome page target. Is Chrome running with --remote-debugging-port=9222?');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => (ws.onopen = resolve));

let id = 0;
const pending = new Map();
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (pending.has(message.id)) pending.get(message.id)(message);
};
const send = (method, params = {}) =>
  new Promise(resolve => {
    const messageId = ++id;
    pending.set(messageId, resolve);
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });

const evaluate = async expression => {
  const response = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return response.result?.result?.value;
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

await send('Page.enable');
await send('Runtime.enable');
await send('Security.setIgnoreCertificateErrors', { ignore: true });
await send('Page.navigate', { url: APP_URL });
await wait(8000);

// Tiles are lazily loaded, so walk the page to make them all fetch. Without
// this only the first rows measure, and those happen to be the widest
// components — which would make the "component, not wrapper" check vacuous.
for (let step = 0; step < 8; step++) {
  await evaluate('scrollBy(0, innerHeight); true');
  await wait(1500);
}
await evaluate('scrollTo(0, 0); true');
await wait(4000);

const failures = [];

// 1. Each preview reports its own box.
const tiles = JSON.parse(
  (await evaluate(`JSON.stringify([...document.querySelectorAll('figure')].map(f => ({
    name: f.querySelector('figcaption')?.firstChild?.textContent?.trim(),
    status: f.querySelector('figcaption small')?.textContent?.trim(),
  })))`)) ?? '[]',
);

const boxes = tiles
  .filter(tile => /^\d+×\d+$/.test(tile.status ?? ''))
  .map(tile => {
    const [width, height] = tile.status.split('×').map(Number);
    return { name: tile.name, width, height };
  });

if (boxes.length === 0) {
  failures.push(
    'No preview reported a measurement. Is the SDK built, and has the site named this origin?',
  );
}

// The wrapper around a component is full-width, so a component narrower than
// the frame is the proof that the component itself is being measured. Read the
// frame's own width rather than assuming one: it is a tuning knob.
const layoutWidth = Number(
  await evaluate(`document.querySelector('.tile iframe')?.getAttribute('width')`),
);

if (boxes.length > 0 && !boxes.some(box => box.width < layoutWidth)) {
  failures.push(
    `Every preview reported the full ${layoutWidth}px frame width, so the wrapper is being measured: ${JSON.stringify(boxes)}`,
  );
}

if (boxes.length > 1 && new Set(boxes.map(box => box.height)).size < 2) {
  failures.push('Every preview reported the same height, so the page is being measured.');
}

// 2. Nothing keeps talking once things have settled.
await evaluate(`window.__seen = []; window.addEventListener('message', e => {
  if (typeof e.data?.type === 'string' && e.data.type.startsWith('optimizely:preview:'))
    window.__seen.push(e.data.type);
}); true`);

await wait(QUIET_PERIOD);

const seen = JSON.parse((await evaluate('JSON.stringify(window.__seen)')) ?? '[]');
if (seen.length > 0) {
  failures.push(
    `${seen.length} protocol messages arrived after the previews settled: ${seen.join(', ')}`,
  );
}

// 3. A measure request is answered. The embedder is the only one that knows it
// resized a frame, and a preview that ignores the request leaves it scaled to a
// frame that no longer exists.
const answered = await evaluate(`(async () => {
  const frame = document.querySelector('.tile iframe');
  if (!frame) return 'no frame on the page';

  const origin = new URL(frame.src).origin;
  const answers = [];
  const listener = event => {
    if (event.source === frame.contentWindow &&
        event.data?.type === 'optimizely:preview:dimensions') answers.push(event.data.payload);
  };
  addEventListener('message', listener);

  frame.contentWindow.postMessage(
    { type: 'optimizely:preview:measure', version: 1 }, origin,
  );
  await new Promise(resolve => setTimeout(resolve, 2000));
  removeEventListener('message', listener);

  return answers.length === 1 ? 'ok'
    : answers.length === 0 ? 'no answer to a measure request'
    : answers.length + ' answers to one measure request';
})()`);

if (answered !== 'ok') failures.push(`measure request: ${answered}`);

ws.close();

console.log(
  `measured ${boxes.length}/${tiles.length} previews:`,
  boxes
    .slice(0, 6)
    .map(box => `${box.name} ${box.width}×${box.height}`)
    .join(', '),
);
console.log(`messages during a ${QUIET_PERIOD}ms quiet period: ${seen.length}`);
console.log(`measure request: ${answered}`);

if (failures.length) {
  console.error('\nFAILED\n' + failures.map(failure => `  - ${failure}`).join('\n'));
  process.exit(1);
}
console.log('\nPASS: components report their own box, and nothing keeps talking.');
