/**
 * End-to-end check for the preview protocol
 * (content-js-sdk/specs/003-preview-iframe-protocol).
 *
 * jsdom cannot prove any of this: there is no layout, so a measurement is
 * whatever the test stubs say. This drives a real browser instead and asserts
 * the two properties the design rests on.
 *
 *   1. A preview reports its *component's* box, not the document's.
 *   2. Re-scaling a tile never makes a preview re-report — the feedback loop
 *      the protocol exists to avoid cannot start.
 *
 * Needs three things running:
 *
 *   cd content-js-sdk/templates/stride && pnpm dev     # the preview host
 *   cd ads-preview && pnpm dev                         # this app
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     --headless=new --remote-debugging-port=9222 --ignore-certificate-errors \
 *     --user-data-dir=/tmp/preview-e2e about:blank
 *
 * Then: node e2e/protocol-check.mjs http://localhost:5173
 */

const APP_URL = process.argv[2] ?? 'http://localhost:5173';
const CDP = 'http://127.0.0.1:9222';

const targets = await (await fetch(`${CDP}/json/list`)).json();
const target = targets.find(t => t.type === 'page');
if (!target) throw new Error('No Chrome page target. Is Chrome running with --remote-debugging-port=9222?');

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

const readReported = () =>
  evaluate(
    `JSON.stringify([...document.querySelectorAll('figcaption small')].map(e => e.textContent))`,
  );

const clickToggle = (group, option) =>
  evaluate(`(() => {
    const groups = [...document.querySelectorAll('[role=group]')];
    const g = groups.find(x => x.getAttribute('aria-label') === '${group}');
    [...g.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('${option}')).click();
    return true;
  })()`);

await send('Page.enable');
await send('Runtime.enable');
await send('Security.setIgnoreCertificateErrors', { ignore: true });
await send('Page.navigate', { url: APP_URL });
await wait(12000);

const failures = [];

// 1. Components report their own box. A page is 720px tall; a button is not.
const tiles = JSON.parse(
  (await evaluate(`JSON.stringify([...document.querySelectorAll('figure')].map(f => ({
    name: f.querySelector('figcaption')?.firstChild?.textContent?.trim(),
    status: f.querySelector('figcaption small')?.textContent?.trim(),
  })))`)) ?? '[]',
);

const measured = tiles.filter(t => /^\d+×\d+$/.test(t.status ?? ''));
if (measured.length === 0) failures.push('No preview reported a measurement at all.');

const boxes = measured.map(t => {
  const [width, height] = t.status.split('×').map(Number);
  return { name: t.name, width, height };
});

if (boxes.some(b => b.height >= 720)) {
  failures.push(
    `A preview reported the page height rather than the component: ${JSON.stringify(boxes)}`,
  );
}
if (new Set(boxes.map(b => b.height)).size < 2) {
  failures.push('Every preview reported the same height, so the page is being measured.');
}
// The wrapper is full-width, so a component narrower than the page proves the
// measurement is of the component itself rather than the box around it.
if (!boxes.some(b => b.width < 1280)) {
  failures.push(
    `Every preview reported the full page width, so the wrapper is being measured: ${JSON.stringify(boxes)}`,
  );
}

// 2. Re-scaling must not re-measure, and must not produce protocol traffic.
await evaluate(`window.__seen = []; window.addEventListener('message', e => {
  if (typeof e.data?.type === 'string' && e.data.type.startsWith('optimizely:preview:'))
    window.__seen.push(e.data.type);
}); true`);

const before = await readReported();
await clickToggle('Tile', 'medium');
await wait(2500);
const afterMedium = await readReported();
await clickToggle('Tile', 'thumbnail');
await wait(2500);
const afterThumbnail = await readReported();
const seen = JSON.parse((await evaluate('JSON.stringify(window.__seen)')) ?? '[]');

if (before !== afterMedium || before !== afterThumbnail) {
  failures.push(
    `Re-scaling changed the reported dimensions, so the preview is reflowing:\n` +
      `  before: ${before}\n  medium: ${afterMedium}\n  thumb:  ${afterThumbnail}`,
  );
}
if (seen.length > 0) {
  failures.push(`Re-scaling produced ${seen.length} protocol messages: ${seen.join(', ')}`);
}

ws.close();

console.log(
  `measured ${measured.length}/${tiles.length} previews:`,
  boxes.map(b => `${b.name} ${b.width}×${b.height}`).join(', '),
);
console.log(`re-scale produced ${seen.length} messages, dimensions stable: ${before === afterThumbnail}`);

if (failures.length) {
  console.error('\nFAILED\n' + failures.map(f => `  - ${f}`).join('\n'));
  process.exit(1);
}
console.log('\nPASS: components report their own box, and re-scaling does not re-measure.');
