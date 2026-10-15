/**
 * Zero-dependency interaction checks against the local index.html.
 * Run after its navigation, search-dialog, and product-section hooks are ready:
 *
 *   node tools/test-interactions.mjs
 *
 * Requires Node with built-in WebSocket. CHROME_PATH can override Chrome's path.
 * Uses a fresh temporary Chrome profile, removed in finally even on failure.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pageURL = pathToFileURL(join(root, 'index.html')).href;
const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let interrupted = false;
let client;
let chrome;
let profile;
let chromeExited;
let passed = 0;

async function waitFor(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (interrupted) throw new Error('Interaction checks interrupted');
    const result = await predicate();
    if (result) return result;
    await sleep(40);
  }
  throw new Error(`Timed out: ${label}`);
}

class DevTools {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.pending = new Map();
    this.sequence = 0;
    this.session = undefined;
    this.pageErrors = [];
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('DevTools connection timed out')), 10000);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('DevTools connection failed'));
      }, { once: true });
    });
    this.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject, timer } = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(timer);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      } else if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        this.pageErrors.push(details.exception?.description || details.text);
      }
    });
    this.socket.addEventListener('close', () => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error('DevTools connection closed'));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}, sessionId = this.session) {
    return new Promise((resolve, reject) => {
      if (this.socket.readyState !== WebSocket.OPEN) {
        reject(new Error(`DevTools unavailable: ${method}`));
        return;
      }
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DevTools command timed out: ${method}`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    }
    return response.result.value;
  }

  close() {
    this.socket.close();
  }
}

const evaluate = (expression) => client.evaluate(expression);
const until = (expression, label) => waitFor(() => evaluate(expression), label);
const frames = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');

async function settleScroll() {
  let previous = NaN;
  let still = 0;
  await waitFor(async () => {
    const y = await evaluate('scrollY');
    still = Math.abs(y - previous) < 1 ? still + 1 : 0;
    previous = y;
    return still >= 4;
  }, 'page scroll settles');
}

async function check(label, run) {
  await run();
  passed++;
  console.log(`PASS ${label}`);
}

async function press(key, modifiers = 0) {
  const codes = { Tab: ['Tab', 9], Escape: ['Escape', 27], Enter: ['Enter', 13], Backspace: ['Backspace', 8], k: ['KeyK', 75] };
  const [code, windowsVirtualKeyCode] = codes[key];
  const params = { key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode, modifiers };
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
}

async function clickPoint(x, y) {
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function click(selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || !element.getClientRects().length) return null;
    const box = element.getBoundingClientRect();
    const left = Math.max(0, box.left), right = Math.min(innerWidth, box.right);
    const top = Math.max(0, box.top), bottom = Math.min(innerHeight, box.bottom);
    return right > left && bottom > top ? { x: (left + right) / 2, y: (top + bottom) / 2 } : null;
  })()`);
  assert.ok(point, `${selector} must be visible and inside the viewport`);
  await clickPoint(point.x, point.y);
}

async function viewport(width, height = 844) {
  await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 833 });
  await until(`innerWidth === ${width}`, `viewport width ${width}`);
  await frames();
}

async function loadPage() {
  async function waitForDocument(url) {
    await waitFor(async () => {
      try {
        return await evaluate(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`);
      } catch (error) {
        if (/Execution context was destroyed|Cannot find context/.test(error.message)) return false;
        throw error;
      }
    }, `document load: ${url}`);
  }
  // A fragment-only navigation would not rerun main.js for the initial
  // reduced-motion check. Visiting blank guarantees a fresh document.
  await client.send('Page.navigate', { url: 'about:blank' });
  await waitForDocument('about:blank');
  const response = await client.send('Page.navigate', { url: pageURL });
  assert.ok(!response.errorText, response.errorText);
  await waitForDocument(pageURL);
  await frames();
}

const layoutState = () => evaluate(`(() => {
  const styles = element => [...element.style].sort().map(property => [property, element.style.getPropertyValue(property), element.style.getPropertyPriority(property)]);
  return {
    body: styles(document.body), root: styles(document.documentElement),
    inert: [...document.querySelectorAll('main, footer')].map(element => element.getAttribute('inert')),
    x: scrollX, y: scrollY
  };
})()`);

async function assertReleased(before, restoreScroll = false) {
  // Native dialog close events are queued after the closing interaction.
  await frames();
  const after = await layoutState();
  assert.deepEqual(after.body, before.body, 'body inline styles must be restored');
  assert.deepEqual(after.root, before.root, 'root inline styles must be restored');
  assert.deepEqual(after.inert, before.inert, 'background inert states must be restored');
  if (restoreScroll) {
    assert.ok(Math.abs(after.y - before.y) <= 2 && Math.abs(after.x - before.x) <= 2, `closing must restore the original scroll position (before ${before.x},${before.y}; after ${after.x},${after.y})`);
  }
}

async function openMenu() {
  await click('[data-nav-toggle]');
  await until(`document.querySelector('[data-nav-toggle]').getAttribute('aria-expanded') === 'true'`, 'mobile menu open');
}

async function openSearch() {
  await click('[data-search-open]');
  await until(`document.querySelector('#search-dialog').matches(':modal') && document.activeElement.id === 'site-search'`, 'modal search focused');
}

async function fillSearch(value) {
  await evaluate(`document.querySelector('#site-search').focus(); document.querySelector('#site-search').select()`);
  await press('Backspace');
  if (value) await client.send('Input.insertText', { text: value });
  await frames();
}

const labels = () => evaluate(`[...document.querySelectorAll('[data-search-results] .search-result__label')].map(element => element.textContent)`);

async function assertFocusTrapped(scopeSelector) {
  const count = await evaluate(`document.querySelector(${JSON.stringify(scopeSelector)}).querySelectorAll('a[href], button, input, [tabindex]').length`);
  for (const modifiers of [0, 8]) {
      for (let index = 0; index < count + 2; index++) {
        await press('Tab', modifiers);
        const inside = await evaluate(`document.querySelector(${JSON.stringify(scopeSelector)}).contains(document.activeElement)`);
        assert.equal(inside, true, `${scopeSelector} must contain keyboard focus`);
    }
  }
}

function interrupt() {
  interrupted = true;
  client?.close();
}
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);

try {
  assert.equal(typeof WebSocket, 'function', 'Node must provide built-in WebSocket');
  const temporaryRoot = join(tmpdir(), 'omnirush');
  await mkdir(temporaryRoot, { recursive: true });
  profile = await mkdtemp(join(temporaryRoot, 'apple-interactions-'));
  let endpoint;
  let launchError;
  let stderr = '';
  chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--disable-extensions', '--disable-background-networking',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1280,900', 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  chromeExited = new Promise((resolve) => {
    chrome.once('exit', resolve);
    chrome.once('error', resolve);
  });
  chrome.once('error', (error) => { launchError = error; });
  chrome.stderr.setEncoding('utf8');
  chrome.stderr.on('data', (text) => {
    stderr = (stderr + text).slice(-20000);
    endpoint = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1] || endpoint;
  });
  await waitFor(() => {
    if (launchError) throw launchError;
    if (chrome.exitCode !== null || chrome.signalCode !== null) throw new Error(`Chrome exited during startup: ${stderr}`);
    return endpoint;
  }, 'Chrome DevTools startup', 15000);

  client = new DevTools(endpoint);
  await client.ready;
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
  client.session = sessionId;
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  // Observe the native scroll call while preserving its real browser behavior.
  await client.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    (() => {
      window.__interactionScrolls = [];
      const originalScrollIntoView = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (options) {
        window.__interactionScrolls.push({ id: this.id, behavior: options?.behavior });
        return originalScrollIntoView.call(this, options);
      };
    })();
  ` });
  await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await loadPage();

  await check('forthcoming HTML contract and immediate above-fold reveals', async () => {
    const missing = await evaluate(`(() => {
      const selectors = ['[data-nav]', 'button[data-nav-toggle][aria-controls="globalnav-menu"]',
        '#globalnav-menu[data-nav-menu]', '.globalnav__list a[href]', '[data-search-open]',
        'dialog#search-dialog.search-dialog', '#search-dialog [data-search-close]',
        '#search-dialog input#site-search[type="search"]', '#search-dialog [data-search-results]',
        '#search-dialog [data-search-status]', 'main', 'footer',
        '#iphone', '#mac', '#ipad', '#macbook-pro', '#airpods', '#watch', '#ipad-pro', '#trade-in', '#apple-card'];
      return selectors.filter(selector => !document.querySelector(selector));
    })()`);
    assert.deepEqual(missing, [], `HTML contract missing: ${missing.join(', ')}`);
    assert.equal(await evaluate(`innerWidth`), 390, 'HTML needs a responsive viewport meta tag');
    assert.equal(await evaluate(`[...document.querySelectorAll('.reveal')].filter(element => element.getBoundingClientRect().top < innerHeight).every(element => element.classList.contains('is-visible'))`), true);
  });

  await check('mobile menu states, inert background, focus trap, Escape, and scroll restoration', async () => {
    await evaluate(`scrollTo({ top: 200, behavior: 'instant' })`);
    await until(`document.querySelector('[data-nav]').getAttribute('data-scrolled') === 'true'`, 'nav scrolled state');
    const before = await layoutState();
    await openMenu();
    assert.equal(await evaluate(`document.querySelector('[data-nav-menu]').getAttribute('data-open') === 'true' && document.body.getAttribute('data-menu-open') === 'true'`), true);
    assert.equal(await evaluate(`[...document.querySelectorAll('main, footer')].every(element => element.inert)`), true);
    assert.equal(await evaluate(`document.querySelector('[data-nav]').getAttribute('data-scrolled')`), 'true');
    const top = await evaluate(`document.querySelector('main').getBoundingClientRect().top`);
    await client.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 380, y: 800, deltaX: 0, deltaY: 400 });
    await frames();
    assert.ok(Math.abs(await evaluate(`document.querySelector('main').getBoundingClientRect().top`) - top) < 2, 'background must stay still');
    await assertFocusTrapped('[data-nav]');
    await press('Escape');
    await until(`document.querySelector('[data-nav-toggle]').getAttribute('aria-expanded') === 'false'`, 'menu Escape close');
    assert.equal(await evaluate(`document.activeElement === document.querySelector('[data-nav-toggle]')`), true);
    assert.equal(await evaluate(`document.querySelector('[data-nav-menu]').inert`), true);
    await assertReleased(before, true);
  });

  await check('nav-link dismissal and exact 833/834px breakpoint', async () => {
    const before = await layoutState();
    await openMenu();
    // Keep the test local even if the HTML's navigation link points to Apple.
    await evaluate(`document.querySelector('.globalnav__list a').addEventListener('click', event => event.preventDefault(), { once: true })`);
    await click('.globalnav__list a');
    await until(`document.body.getAttribute('data-menu-open') === 'false'`, 'nav link closes menu');
    await assertReleased(before, true);
    await viewport(833);
    await openMenu();
    await viewport(834);
    await until(`document.querySelector('[data-nav-toggle]').getAttribute('aria-expanded') === 'false' && !document.querySelector('[data-nav-menu]').inert`, 'desktop resize closes menu');
    await assertReleased(before);
    await viewport(390);
  });

  await check('menu-to-native-search handoff, suggestions, modal focus, and Escape restoration', async () => {
    const before = await layoutState();
    await openMenu();
    await openSearch();
    assert.equal(await evaluate(`document.body.getAttribute('data-menu-open') === 'false' && document.querySelector('[data-nav-toggle]').getAttribute('aria-expanded') === 'false'`), true);
    assert.deepEqual(await labels(), ['iPhone', 'MacBook Air', 'iPad Air', 'MacBook Pro', 'AirPods Pro 3']);
    assert.equal(await evaluate(`[...document.querySelectorAll('.search-result')].every(link => link.tagName === 'A' && link.getAttribute('href').startsWith('#') && link.querySelector('.search-result__label') && link.querySelector('.search-result__detail')?.textContent.trim() && link.querySelector('.search-result__arrow[aria-hidden="true"]')?.textContent === '↗')`), true);
    assert.equal(await evaluate(`document.querySelector('[data-search-status]').getAttribute('aria-live') === 'polite' && /5/.test(document.querySelector('[data-search-status]').textContent)`), true);
    assert.deepEqual((await layoutState()).inert, before.inert, 'menu inert state must be released before the dialog opens');
    await assertFocusTrapped('#search-dialog');
    await press('Escape');
    await until(`!document.querySelector('#search-dialog').open && document.activeElement === document.querySelector('[data-search-open]')`, 'search Escape restores trigger focus');
    await assertReleased(before, true);
  });

  await check('Ctrl/Cmd+K and typing-field exclusions', async () => {
    for (const modifier of [2, 4]) {
      await press('k', modifier);
      await until(`document.querySelector('#search-dialog').open && document.activeElement.id === 'site-search'`, 'keyboard shortcut opens search');
      await press('Escape');
      await until(`!document.querySelector('#search-dialog').open`, 'shortcut dialog closes');
    }
    for (const tag of ['input', 'textarea', 'div']) {
      await evaluate(`(() => {
        const probe = document.createElement(${JSON.stringify(tag)});
        probe.id = 'interaction-typing-probe';
        if (probe.tagName === 'DIV') probe.contentEditable = 'true';
        probe.style.cssText = 'position:fixed;top:1px;left:1px;width:10px;height:10px;z-index:1000;';
        document.body.append(probe);
        probe.tabIndex = 0;
        probe.focus();
      })()`);
      try {
        for (const modifier of [2, 4]) {
          await press('k', modifier);
          assert.equal(await evaluate(`document.querySelector('#search-dialog').open`), false, 'typing in another field must not open search');
        }
      } finally {
        await evaluate(`document.querySelector('#interaction-typing-probe')?.remove(); document.querySelector('[data-search-open]').focus({ preventScroll: true })`);
      }
    }
  });

  await check('all nine products, case-insensitive aliases, and safe no-results state', async () => {
    await openSearch();
    const queries = [
      ['IPHONE', ['iPhone']], ['MacBook Air', ['MacBook Air']], ['iPad Air', ['iPad Air']],
      ['MacBook Pro', ['MacBook Pro']], ['AirPods Pro 3', ['AirPods Pro 3']],
      ['Apple Watch Series 11', ['Apple Watch Series 11']], ['iPad Pro', ['iPad Pro']],
      ['Apple Trade In', ['Apple Trade In']], ['Apple Card', ['Apple Card']],
      ['mac', ['MacBook Air', 'MacBook Pro']], ['watch', ['Apple Watch Series 11']],
      ['headphones', ['AirPods Pro 3']], ['tablet', ['iPad Air', 'iPad Pro']], ['trade', ['Apple Trade In']]
    ];
    for (const [query, expected] of queries) {
      await fillSearch(query);
      assert.deepEqual(await labels(), expected, `results for ${query}`);
    }
    await fillSearch('<img src=x onerror="window.__searchInjected=true">');
    assert.deepEqual(await labels(), []);
    assert.equal(await evaluate(`!window.__searchInjected && !document.querySelector('[data-search-results] img, [data-search-results] script') && /0 results/.test(document.querySelector('[data-search-status]').textContent) && document.querySelector('[data-search-results]').textContent.trim().length > 0`), true);
    await press('Enter');
    assert.equal(await evaluate(`document.querySelector('#search-dialog').open`), true, 'Enter with no results must keep search open');
    await fillSearch('   ');
    assert.equal((await labels()).length, 5, 'cleared search restores suggestions');
    await click('[data-search-close]');
    await until(`!document.querySelector('#search-dialog').open && document.activeElement === document.querySelector('[data-search-open]')`, 'close button restores focus');
  });

  await check('Enter activates first result, smooth navigation, and released page scrolling', async () => {
    const before = await layoutState();
    await openSearch();
    await fillSearch('mac');
    await press('Enter');
    await until(`!document.querySelector('#search-dialog').open && location.hash === '#mac'`, 'Enter navigates to first result');
    await assertReleased(before);
    assert.equal(await evaluate(`window.__interactionScrolls.filter(call => call.id === 'mac').at(-1)?.behavior`), 'smooth');
    await until(`document.querySelector('#mac').getBoundingClientRect().top < 180 && document.querySelector('#mac').getBoundingClientRect().bottom > 0`, 'Mac section scrolled into view');
    await settleScroll();
    const y = await evaluate('scrollY');
    await client.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 380, y: 800, deltaX: 0, deltaY: 240 });
    await until(`scrollY > ${y + 40}`, 'page remains scrollable after result activation');
    await settleScroll();
  });

  await check('desktop backdrop dismissal and scroll/focus restoration', async () => {
    await viewport(1280, 900);
    const before = await layoutState();
    await openSearch();
    const point = await evaluate(`(() => {
      const box = document.querySelector('#search-dialog').getBoundingClientRect();
      return [{ x: 2, y: 2 }, { x: innerWidth - 2, y: 2 }, { x: 2, y: innerHeight - 2 }, { x: innerWidth - 2, y: innerHeight - 2 }]
        .find(point => point.x < box.left || point.x > box.right || point.y < box.top || point.y > box.bottom);
    })()`);
    assert.ok(point, 'desktop dialog must leave some clickable backdrop');
    await clickPoint(point.x, point.y);
    await until(`!document.querySelector('#search-dialog').open && document.activeElement === document.querySelector('[data-search-open]')`, 'backdrop closes search and restores focus');
    await assertReleased(before, true);
  });

  await check('reduced-motion result click and immediate reveals', async () => {
    await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await until(`matchMedia('(prefers-reduced-motion: reduce)').matches && [...document.querySelectorAll('.reveal')].every(element => element.classList.contains('is-visible'))`, 'live reduced-motion change');
    const before = await layoutState();
    await openSearch();
    await fillSearch('watch');
    await click('[data-search-results] .search-result');
    await until(`!document.querySelector('#search-dialog').open && location.hash === '#watch'`, 'result click navigates');
    assert.equal(await evaluate(`window.__interactionScrolls.filter(call => call.id === 'watch').at(-1)?.behavior`), 'instant');
    await assertReleased(before);
    assert.equal(await evaluate(`document.activeElement === document.querySelector('#watch')`), true, 'result navigation moves focus to its section');
    await loadPage();
    assert.equal(await evaluate(`[...document.querySelectorAll('.reveal')].every(element => element.classList.contains('is-visible') && Number(getComputedStyle(element).opacity) >= 0.99)`), true);
  });

  assert.deepEqual(client.pageErrors, [], 'page must not raise JavaScript exceptions');
  console.log(`\n${passed} interaction groups passed against ${pageURL}`);
} catch (error) {
  console.error(`\nFAIL ${error.stack || error}`);
  process.exitCode = interrupted ? 130 : 1;
} finally {
  // Browser.close shuts down this isolated Chrome tree, including renderers.
  if (client) {
    await client.send('Browser.close', {}, null).catch(() => {});
    client.close();
  }
  if (chrome?.pid && chrome.exitCode === null && chrome.signalCode === null) {
    await Promise.race([chromeExited, sleep(2000)]);
    if (chrome.exitCode === null && chrome.signalCode === null) {
      if (process.platform === 'win32') {
        await new Promise((resolve) => {
          const killer = spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
          killer.once('error', resolve);
          killer.once('exit', resolve);
        });
      } else chrome.kill('SIGKILL');
      await Promise.race([chromeExited, sleep(2000)]);
    }
  }
  if (profile) {
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch((error) => {
      console.error(`Temporary Chrome profile cleanup failed: ${error.message}`);
      process.exitCode ||= 1;
    });
  }
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
