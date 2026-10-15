/**
 * Smoke test for the homepage: verifies every local asset reference resolves,
 * the SVGs are well-formed enough to render, the CSS has balanced braces with
 * no undeclared custom properties, and the a11y relationships point at real ids.
 *
 *   node tools/validate.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'css/styles.css'), 'utf8');
const js = readFileSync(join(root, 'js/main.js'), 'utf8');

let failures = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { console.log('  FAIL  ' + m); failures++; };

console.log('\nAssets');
const refs = [...html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)]
  .map((m) => m[1])
  .filter((u) => !/^(https?:|data:|mailto:|tel:)/.test(u));
const srcsets = [...html.matchAll(/srcset="([^"]+)"/g)]
  .flatMap((m) => m[1].split(',').map((candidate) => candidate.trim().split(/\s+/)[0]))
  .filter((u) => u && !/^(https?:|data:|mailto:|tel:)/.test(u));
refs.push(...srcsets);
refs.forEach((u) => (existsSync(resolve(root, u)) ? ok(u) : bad('missing ' + u)));

const onDisk = readdirSync(join(root, 'assets'));
const intentionallyUnused = new Set([
  'apple-assets.json', 'IMAGE-GUIDE.md',
  'airpods-pro.svg', 'apple-card.svg', 'apple-watch-series-11.svg',
  'ipad-air.svg', 'ipad-pro.svg', 'iphone-17-pro.svg', 'iphone-17.svg',
  'macbook-air.svg', 'macbook-pro.svg', 'trade-in.svg'
]);
onDisk
  .filter((f) => !intentionallyUnused.has(f) && !refs.includes('assets/' + f))
  .forEach((f) => bad('orphan asset not referenced: assets/' + f));

console.log('\nSVG sanity');
refs.filter((u) => u.endsWith('.svg')).forEach((u) => {
  const s = readFileSync(resolve(root, u), 'utf8');
  const open = (s.match(/<[a-zA-Z]/g) || []).length;
  const close = (s.match(/<\/[a-zA-Z]|\/>/g) || []).length;
  const literalOnly = s.replace(/url\(#[^)]*\)/g, '').replace(/href="#[^"]*"/g, '');
  const badColor = literalOnly.match(/#[0-9a-fA-F]*[g-zG-Z][0-9a-zA-Z]*/g);
  if (open !== close) bad(`${u}: tag mismatch open=${open} close=${close}`);
  else if (!/<\/svg>\s*$/.test(s.trim())) bad(`${u}: missing closing </svg>`);
  else if (badColor) bad(`${u}: invalid colour literal ${badColor.join(', ')}`);
  else ok(`${u} (${open} elements)`);
});

console.log('\nCSS');
const delta = (css.match(/{/g) || []).length - (css.match(/}/g) || []).length;
delta === 0 ? ok('braces balanced') : bad('brace delta ' + delta);

const declared = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
[...new Set([...css.matchAll(/var\((--[\w-]+)\s*\)/g)].map((m) => m[1]))]
  .filter((v) => !declared.has(v))
  .forEach((v) => bad('undeclared custom property var(' + v + ')'));
ok(`${declared.size} custom properties declared`);

console.log('\nHTML');
[...html.matchAll(/aria-labelledby="([^"]+)"/g)].map((m) => m[1]).forEach((id) =>
  html.includes(`id="${id}"`) ? ok('aria-labelledby -> #' + id) : bad('dangling aria-labelledby #' + id));
[...html.matchAll(/aria-controls="([^"]+)"/g)].map((m) => m[1]).forEach((id) =>
  html.includes(`id="${id}"`) ? ok('aria-controls -> #' + id) : bad('dangling aria-controls #' + id));

console.log('\nJavaScript');
try {
  new Function(js);
  ok('js/main.js parses');
} catch (error) {
  bad('js/main.js syntax: ' + error.message);
}

console.log('\nInteraction hooks');
const optionalHooks = new Set(['data-finish', 'data-finish-label']);
 [...new Set([...js.matchAll(/\[(data-[\w-]+)\]/g)].map((m) => m[1]))].forEach((attr) => {
  if (optionalHooks.has(attr)) return ok(`[${attr}] optional hook`);
  html.includes(attr) ? ok(`[${attr}] present in markup`) : bad(`[${attr}] selected in JS but missing from index.html`);
 });
[...new Set([...html.matchAll(/(data-[\w-]+)(?==")/g)].map((m) => m[1]))].forEach((attr) =>
  js.includes(attr) ? ok(`${attr} wired in JS`) : bad(`${attr} in markup but never used by JS`));

console.log('\nStructure');
const count = (re) => (html.match(re) || []).length;
console.log(`  sections: ${count(/<section/g)}  tiles: ${count(/class="tile /g) + count(/<article class="tile"/g)}`);
console.log(`  product renders: ${refs.filter((u) => u.endsWith('.svg')).length - 1}  reveals: ${count(/reveal/g)}`);
console.log(`  dark invert bands: ${count(/band--dark|tile--dark/g)}  pill CTAs: ${count(/class="btn /g)}`);

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
