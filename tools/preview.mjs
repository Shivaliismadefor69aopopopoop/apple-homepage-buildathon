/**
 * Headless preview harness (no dependencies — talks to Chrome over DevTools
 * Protocol using Node's built-in fetch + WebSocket).
 *
 *   node tools/preview.mjs
 *
 * Emulates a real desktop and mobile viewport, reports horizontal overflow,
 * and writes section screenshots into .preview/.
 */
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.preview');
const url = 'file:///' + join(root, 'index.html').replace(/\\/g, '/');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;

mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${join(root, '.chrome-inspect')}`,
  '--window-size=1440,900', 'about:blank'
], { stdio: 'ignore', detached: false });

let wsUrl = null;
for (let i = 0; i < 60 && !wsUrl; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    wsUrl = (list.find((t) => t.type === 'page') || {}).webSocketDebuggerUrl || null;
  } catch { /* chrome still starting */ }
}
if (!wsUrl) { chrome.kill(); throw new Error('DevTools endpoint unavailable'); }

const ws = new WebSocket(wsUrl);
await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });

let seq = 0;
const pending = new Map();
let loader = null;
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { ok, fail } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? fail(new Error(JSON.stringify(msg.error))) : ok(msg.result);
  } else if (msg.method === 'Page.loadEventFired' && loader) {
    const fn = loader;
    loader = null;
    fn();
  }
};

const send = (method, params = {}) => new Promise((ok, fail) => {
  const id = ++seq;
  pending.set(id, { ok, fail });
  ws.send(JSON.stringify({ id, method, params }));
});

const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;

const shoot = async (name, clip, scale = 1) => {
  const { data } = await send('Page.captureScreenshot', {
    format: 'png', fromSurface: true, captureBeyondViewport: Boolean(clip),
    ...(clip ? { clip: { ...clip, scale } } : {})
  });
  writeFileSync(join(out, name), Buffer.from(data, 'base64'));
  console.log('    wrote .preview/' + name);
};

const DIAGNOSTICS = `(() => {
  const vw = window.innerWidth;
  const wide = [...document.querySelectorAll('body *')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > vw + 1 && r.height > 0; })
    .map((el) => el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim().split(/\\s+/).join('.') : '') + ' @' + Math.round(el.getBoundingClientRect().width));
  return JSON.stringify({
    vw,
    docWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    height: document.documentElement.scrollHeight,
    wide
  });
})()`;

const boxOf = async (selector) => JSON.parse(await evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return 'null';
  const r = el.getBoundingClientRect();
  return JSON.stringify({ x: r.left, y: r.top + window.scrollY, width: r.width, height: r.height });
})()`));

await send('Page.enable');
await send('Runtime.enable');

/** Scrolls the page the way a human would, so IntersectionObserver actually
 *  fires before any capture. Without this, clipped captures screenshot the
 *  reveal animation mid-flight and sections look empty. */
async function sweep() {
  await evaluate(`(async () => {
    const step = Math.round(window.innerHeight * 0.7) || 400;
    for (let y = 0; y <= document.documentElement.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 140));
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 60));
  })()`);
  await sleep(1500); /* longest transition (0.8s) + max stagger delay (450ms) */
}

const REVEALS = `(() => {
  const all = [...document.querySelectorAll('.reveal')];
  const faded = all
    .filter((el) => Number(getComputedStyle(el).opacity) < 0.99)
    .map((el) => el.tagName.toLowerCase() + '.' + String(el.className).trim().replace(/\\s+/g, '.'));
  const broken = [...document.images]
    .filter((img) => !img.complete || !img.naturalWidth)
    .map((img) => img.getAttribute('src'));
  return JSON.stringify({
    reveals: all.length,
    faded,
    images: document.images.length,
    broken,
    tiles: [...document.querySelectorAll('.tile')].map((tile) => {
      const title = tile.querySelector('h3');
      const img = tile.querySelector('.tile__media img');
      return {
        title: title ? title.textContent.trim() : '?',
        tile: Math.round(tile.getBoundingClientRect().height),
        media: img ? Math.round(img.getBoundingClientRect().height) : 0
      };
    })
  });
})()`;

async function visit(label, metrics) {
  await send('Emulation.setDeviceMetricsOverride', metrics);
  const loaded = new Promise((ok) => { loader = ok; });
  await send('Page.navigate', { url });
  await loaded;
  await sleep(1200); /* lazy images decode, failsafe pass runs */
  await sweep();

  const diag = JSON.parse(await evaluate(DIAGNOSTICS));
  const reveal = JSON.parse(await evaluate(REVEALS));

  console.log(`\n[${label}] viewport ${diag.vw}px · document ${diag.docWidth}px · height ${diag.height}px`);
  console.log('    overflow: ' + (diag.wide.length ? diag.wide.slice(0, 8).join(' | ') : 'none'));
  console.log(`    reveals: ${reveal.reveals - reveal.faded.length}/${reveal.reveals} visible` +
    (reveal.faded.length ? ' — still faded: ' + reveal.faded.join(' | ') : ''));
  console.log(`    images : ${reveal.images - reveal.broken.length}/${reveal.images} decoded` +
    (reveal.broken.length ? ' — broken: ' + reveal.broken.join(' | ') : ''));
  console.log('    tiles  : ' + reveal.tiles.map((t) => `${t.title} ${t.tile}x${t.media}`).join(' | '));

  assert.ok(diag.docWidth <= diag.vw, `${label}: horizontal page overflow`);
  assert.equal(reveal.broken.length, 0, `${label}: images must decode`);
  assert.equal(reveal.faded.length, 0, `${label}: all visited content must be visible`);
  assert.equal(reveal.tiles.length, 6, `${label}: all six promos must render`);
  return { ...diag, reveal };
}

/** Screenshot of exactly what the emulated viewport shows — no clipping,
 *  no captureBeyondViewport, so what you see is what a device renders. */
const shootViewport = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  writeFileSync(join(out, name), Buffer.from(data, 'base64'));
  console.log('    wrote .preview/' + name);
};

/** Hovers the centre of the first match to prove a hover state. */
const hoverShot = async (name, selector) => {
  const page = await boxOf(selector);
  await evaluate(`window.scrollTo({ top: ${Math.round(page.y)}, behavior: 'instant' })`);
  await sleep(500);
  const point = JSON.parse(await evaluate(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(Math.min(r.top + r.height / 2, window.innerHeight - 40)) });
  })()`));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' });
  await sleep(700);
  await shootViewport(name);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4, button: 'none' });
};

/* ------------------------------------------------ desktop ------------------ */
const desktop = await visit('desktop', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await shootViewport('desktop-viewport.png');
await shoot('desktop-hero.png', { x: 0, y: 0, width: 1440, height: 1040 });
const macBand = await boxOf('#mac');
await shoot('desktop-macbook-band.png', { x: 0, y: macBand.y - 40, width: 1440, height: Math.min(macBand.height + 80, 1200) });
/* Same treatment for the sibling showcase band so the pair can be compared
   side by side when checking the vertical rhythm / optical balance */
const ipadBand = await boxOf('#ipad');
await shoot('desktop-ipad-band.png', { x: 0, y: ipadBand.y - 40, width: 1440, height: Math.min(ipadBand.height + 80, 1200) });
const promos = await boxOf('.promos');
await shoot('desktop-promos.png', { x: 0, y: promos.y, width: 1440, height: Math.min(promos.height, 2600) });
const footer = await boxOf('.footer');
await shoot('desktop-footer.png', { x: 0, y: footer.y, width: 1440, height: Math.min(footer.height + 20, 900) });
await hoverShot('desktop-tile-hover.png', '.tile--dark');

/* The search is an actual modal, not a decorative header icon. */
await evaluate('window.scrollTo({ top: 0, behavior: "instant" })');
await evaluate("document.querySelector('[data-search-open]').click()");
await sleep(350);
await shootViewport('desktop-search.png');
await evaluate("document.querySelector('[data-search-close]').click()");

console.log(`    desktop page height: ${desktop.height}px`);

/* ------------------------------------------------- mobile ------------------ */
const mobile = await visit('mobile', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await shootViewport('mobile-viewport.png');
await shoot('mobile-hero.png', { x: 0, y: 0, width: 390, height: 1400 }, 2);
const mPromos = await boxOf('.promos');
await shoot('mobile-promos.png', { x: 0, y: mPromos.y, width: 390, height: Math.min(mPromos.height, 2200) });
await evaluate("document.querySelector('[data-nav-toggle]').click()");
await sleep(600);

/* The dismiss control has to sit in the header row, beside the icons — if it is
   ordered after the full-width panel it renders at the bottom of the open menu. */
const menuGeo = JSON.parse(await evaluate(`(() => {
  const box = (sel) => { const r = document.querySelector(sel).getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; };
  const links = document.querySelectorAll('.globalnav__list li');
  return JSON.stringify({
    row: Math.round(document.querySelector('.globalnav__inner').getBoundingClientRect().height),
    toggle: box('[data-nav-toggle]'),
    menu: box('[data-nav-menu]'),
    utilities: box('.globalnav__utilities'),
    links: links.length
  });
})()`));
const t = menuGeo.toggle, m = menuGeo.menu, u = menuGeo.utilities;
const toggleInRow = t.bottom <= m.top + 2 && t.left >= u.right - 4;
console.log(`    menu open: row ${menuGeo.row}px · icons right ${u.right} · toggle y ${t.top}-${t.bottom} x ${t.left}-${t.right} ` +
  `· panel y ${m.top}-${m.bottom} (${menuGeo.links} links)  ` +
  (toggleInRow ? '[toggle in header row]' : '[TOGGLE MISPLACED]'));

await shootViewport('mobile-menu-open.png');
await shoot('mobile-menu-panel.png', { x: 0, y: 0, width: 390, height: 900 }, 2);
await evaluate("document.querySelector('[data-nav-toggle]').click()");
await sleep(300);
console.log(`    mobile page height: ${mobile.height}px`);

await evaluate("document.querySelector('[data-search-open]').click()");
await sleep(350);
await shootViewport('mobile-search.png');
await evaluate("document.querySelector('[data-search-close]').click()");

await visit('tablet', { width: 834, height: 1112, deviceScaleFactor: 1, mobile: false });
await shootViewport('tablet-viewport.png');
await visit('narrow mobile', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
await shootViewport('narrow-mobile-viewport.png');

ws.close();
chrome.kill();
console.log('\nPreview complete.\n');
process.exit(0);
