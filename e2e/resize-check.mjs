/**
 * Checks what a preview does when its frame is resized.
 *
 * The tile grid never resizes a frame, so none of this is covered by
 * `protocol-check.mjs`. This drives the resize lab — the app's second page,
 * at `?lab` — by moving its real controls, the way a person would.
 *
 * Four cases, each a thing that broke before:
 *
 *   1. A frame that changes width. The component reflows, or is recentred,
 *      so the preview should report it unasked.
 *   2. A frame that only changes height. The preview centres the component,
 *      so this moves it down the page without changing its size — reported
 *      only because offsets count as movement, which they did not used to.
 *   3. A change too small to matter. Under 8px is jitter, and must be
 *      silent — but `measure` must still answer.
 *   4. Many resize events in a row. These must coalesce, or a dragged panel
 *      would post a message per frame per tile.
 *
 * Needs the site and this app running:
 *
 *   cd content-js-sdk/templates/stride && pnpm dev
 *   cd ads-preview && pnpm dev
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     --headless=new --remote-debugging-port=9222 --ignore-certificate-errors \
 *     --user-data-dir=/tmp/resize-e2e about:blank
 *
 * Then: node e2e/resize-check.mjs http://localhost:5173
 */

const APP_URL = process.argv[2] ?? 'http://localhost:5173';

const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
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
const evaluate = async expression =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
    .result?.result?.value;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Moves a range input the way a person does. React listens for events, not
 * for assignments, so the value goes through the native setter first.
 */
const drag = (slider, ...values) =>
  evaluate(`(() => {
    const input = document.getElementById(${JSON.stringify(slider)});
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const value of ${JSON.stringify(values)}) {
      set.call(input, String(value));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return true;
  })()`);

const click = selector => evaluate(`document.getElementById('${selector}').click(), true`);
const logLines = async () =>
  (await evaluate(`document.getElementById('log').textContent`))
    .split('\n')
    // Drop the timestamp. It may carry an am/pm, which has a space in it.
    .map(line => line.replace(/^\d{1,2}:\d{2}:\d{2}(\s?[ap]m)?\s+/i, '').trim())
    .filter(Boolean);

await send('Page.enable');
await send('Runtime.enable');
await send('Security.setIgnoreCertificateErrors', { ignore: true });
await send('Page.navigate', { url: `${APP_URL}/?lab` });
await wait(7000);

const first = await logLines();
if (first.length === 0) throw new Error('No first measurement. Is the site running?');
console.log(`first measurement: ${first[0]}`);

const failures = [];
const report = (name, lines) =>
  console.log(`\n${name}\n${lines.length ? lines.map(l => '  ' + l).join('\n') : '  (silence)'}`);

/** Clears the log, does something, and returns what the preview said about it. */
async function after(name, action) {
  await click('clear');
  await action();
  await wait(2000);
  const lines = await logLines();
  report(name, lines);
  return lines;
}

// 1. The frame's width is the component's layout width, so this is a
// different layout — and for a fixed-size component, a different position.
const widened = await after('width 343 → 700', () => drag('w', 700));
if (widened.length === 0) failures.push('a frame that changed width reported nothing');

// 2. Height only. The component keeps its size but is centred lower, so this
// is caught only because offsets count as movement.
const heightened = await after('height 193 → 900', () => drag('h', 900));
if (heightened.length === 0) failures.push('a frame that changed height reported nothing');

// 3. Under the 8px threshold: jitter, not a resize.
const nudged = await after('height 900 → 902', () => drag('h', 902));
if (nudged.length > 0) {
  failures.push(`a 2px change reported ${nudged.length} times — threshold not applied`);
}

// …but asking always gets an answer. This is the case `measure` exists for.
const asked = await after('…then measure', () => click('measure'));
const answers = asked.filter(line => line.startsWith('dimensions'));
if (answers.length !== 1) {
  failures.push(`measure gave ${answers.length} answers, expected exactly 1`);
}

// 4. A drag: many events, one paint. Not one message each.
const dragged = await after('a drag: 21 widths in one go', () =>
  drag('w', ...Array.from({ length: 21 }, (_, step) => 400 + step * 20)),
);
if (dragged.length > 3) {
  failures.push(`a drag produced ${dragged.length} messages — not coalescing`);
}

ws.close();

if (failures.length) {
  console.error('\nFAILED\n' + failures.map(f => `  - ${f}`).join('\n'));
  process.exit(1);
}
console.log('\nPASS: resizes report, jitter does not, measure always answers, drags coalesce.');
