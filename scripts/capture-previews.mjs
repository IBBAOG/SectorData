/**
 * Headless Chrome screenshot capture via CDP (no external deps, Node 24+)
 * Injects Supabase auth token so dashboard pages render authenticated.
 */
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '../public/previews');
mkdirSync(OUT_DIR, { recursive: true });

const AUTH_TOKEN_KEY = 'sb-rrrkgynlpqtmvuuqdjpb-auth-token';
const BASE_URL = 'http://localhost:3002';
const CDP_PORT = 9333; // different port to avoid conflict with any running instance

const PAGES = [
  { path: '/',                       file: 'preview-sales.jpg' },
  { path: '/market-share',           file: 'preview-market-share.jpg' },
  { path: '/navios-diesel',          file: 'preview-navios-diesel.jpg' },
  { path: '/diesel-gasoline-margins',file: 'preview-dg-margins.jpg' },
  { path: '/price-bands',            file: 'preview-price-bands.jpg' },
];

// ── CDP helpers ──────────────────────────────────────────────────────────────

function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const pending = new Map();
    const listeners = new Map();

    ws.onopen = () => resolve(client);
    ws.onerror = (e) => reject(e);
    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) {
        const cb = listeners.get(msg.method);
        if (cb) cb(msg.params);
      }
    };

    const client = {
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const id = msgId++;
          pending.set(id, { res, rej });
          ws.send(JSON.stringify({ id, method, params }));
        });
      },
      on(event, cb) { listeners.set(event, cb); },
      close() { ws.close(); },
    };
  });
}

async function waitForNetworkIdle(client, idleMs = 2000, timeout = 20000) {
  return new Promise((resolve) => {
    let inflight = 0;
    let timer;

    const tryResolve = () => {
      clearTimeout(timer);
      timer = setTimeout(resolve, idleMs);
    };

    client.on('Network.requestWillBeSent', () => { inflight++; clearTimeout(timer); });
    client.on('Network.loadingFinished',   () => { inflight = Math.max(0, inflight - 1); if (inflight === 0) tryResolve(); });
    client.on('Network.loadingFailed',     () => { inflight = Math.max(0, inflight - 1); if (inflight === 0) tryResolve(); });

    // Fallback timeout
    setTimeout(resolve, timeout);
    // Start timer in case network is already idle
    tryResolve();
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

const CHROME_ARGS = [
  `--remote-debugging-port=${CDP_PORT}`,
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--window-size=1400,800',
  '--hide-scrollbars',
  '--disable-extensions',
  'about:blank',
];

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

console.log('Launching Chrome headless...');
const chrome = spawn(CHROME_PATH, CHROME_ARGS, { stdio: 'ignore' });
chrome.on('error', (e) => { console.error('Chrome failed to start:', e); process.exit(1); });

// Wait for Chrome to initialise
await new Promise(r => setTimeout(r, 2000));

// Get debugger targets
let targets;
try {
  const resp = await fetch(`http://localhost:${CDP_PORT}/json/list`);
  targets = await resp.json();
} catch (e) {
  console.error('Could not connect to Chrome CDP:', e.message);
  chrome.kill();
  process.exit(1);
}

const target = targets.find(t => t.type === 'page') || targets[0];
if (!target) { console.error('No page target'); chrome.kill(); process.exit(1); }

console.log('Connected to Chrome CDP');
const client = await cdpConnect(target.webSocketDebuggerUrl);

await client.send('Network.enable');
await client.send('Page.enable');
await client.send('Emulation.setDeviceMetricsOverride', {
  width: 1400, height: 800, deviceScaleFactor: 1, mobile: false,
});

for (const { path, file } of PAGES) {
  const url = BASE_URL + path;
  console.log(`Capturing ${url} ...`);

  // Navigate to target page
  await client.send('Page.navigate', { url });

  // Inject auth token into localStorage after navigation
  await new Promise(r => setTimeout(r, 800));
  await client.send('Runtime.evaluate', {
    expression: `localStorage.setItem(${JSON.stringify(AUTH_TOKEN_KEY)}, ${JSON.stringify(process.env.AUTH_TOKEN)});`,
  });

  // Reload so Next.js picks up the token
  await client.send('Page.reload', { ignoreCache: true });
  await new Promise(r => setTimeout(r, 500));
  await waitForNetworkIdle(client, 1500, 18000);

  // Extra wait for Plotly charts
  await new Promise(r => setTimeout(r, 3000));

  const { data } = await client.send('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 85,
    clip: { x: 0, y: 0, width: 1400, height: 800, scale: 1 },
  });

  const outPath = join(OUT_DIR, file);
  writeFileSync(outPath, Buffer.from(data, 'base64'));
  console.log(`  ✓ Saved ${outPath}`);
}

client.close();
chrome.kill();
console.log('\nAll screenshots captured!');
