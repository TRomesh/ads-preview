/**
 * Checks the README's "minimal implementation" against a real preview.
 *
 * Documented code rots quietly: nothing compiles it and nothing runs it.
 * [e2e/snippet/index.html](snippet/index.html) is that snippet transcribed to
 * plain DOM, and this measures where the component actually lands on the
 * page — the transform either lines the component up with the tile or it
 * does not.
 *
 * Needs the site running, and the snippet served from an origin the site
 * trusts. The static server stands in for this app, so stop `pnpm dev` first:
 *
 *   cd content-js-sdk/templates/stride && pnpm dev
 *   cd ads-preview/e2e/snippet && python3 -m http.server 5173
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     --headless=new --remote-debugging-port=9222 --ignore-certificate-errors \
 *     --user-data-dir=/tmp/snippet-e2e about:blank
 *
 * Then: node e2e/snippet-check.mjs http://localhost:5173/
 */

const PAGE = process.argv[2] ?? 'http://localhost:5173/';
const COMPONENTS = ['ButtonElement', 'HeadingElement', 'ImageCardElement'];

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

await send('Page.enable');
await send('Runtime.enable');
await send('Security.setIgnoreCertificateErrors', { ignore: true });

const failures = [];

for (const component of COMPONENTS) {
  await send('Page.navigate', { url: `${PAGE}?c=${component}` });
  await new Promise(resolve => setTimeout(resolve, 6000));

  const result = await evaluate('JSON.stringify(window.__check())');
  if (!result) {
    failures.push(`${component}: the page never ran`);
    continue;
  }

  const check = JSON.parse(result);
  console.log(
    `${component.padEnd(18)} box ${check.box.width}×${check.box.height} ` +
      `@ ${check.box.offsetX},${check.box.offsetY}  scale ${check.scale.toFixed(3)}  ` +
      `→ off by ${check.dx},${check.dy}  gap ${check.widthGap}×${check.heightGap}`,
  );

  // A pixel of rounding is fine. Anything more means the component is not
  // where the tile is.
  if (Math.abs(check.dx) > 1 || Math.abs(check.dy) > 1) {
    failures.push(
      `${component}: component sits ${check.dx},${check.dy} from the tile's corner`,
    );
  }
  if (Math.abs(check.widthGap) > 1 || Math.abs(check.heightGap) > 1) {
    failures.push(
      `${component}: tile is ${check.widthGap}×${check.heightGap} larger than the component in it`,
    );
  }
}

ws.close();

if (failures.length) {
  console.error('\nFAILED\n' + failures.map(f => `  - ${f}`).join('\n'));
  process.exit(1);
}
console.log('\nPASS: the snippet frames the component exactly.');
