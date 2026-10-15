#!/usr/bin/env node
// Node 20+. Fixed Apple pages, no crawling, no packages, no image transformations.
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const DIRECTORY = new URL('assets/', ROOT);
const MANIFEST = new URL('apple-assets.json', DIRECTORY);
const ORIGIN = 'https://www.apple.com';
const GENERATED_BY = 'tools/fetch-assets.mjs';
const LIMITS = { requests: 64, file: 12 * 1024 ** 2, total: 100 * 1024 ** 2, timeout: 25000 };
let requests = 0;
let received = 0;

// These filename stems were discovered in the pages' actual picture/srcset markup.
// Match both 2x variants there; never manufacture image URLs or guess hash suffixes.
const PRODUCTS = [
  { name: 'iphone-hero', page: '/ge/', stem: 'hero_iphone_family',
    composition: 'iPhone 17 Pro, iPhone 17, iPhone 17e and edge-on iPhone Air; light background.' },
  { name: 'macbook-air', page: '/ge/', stem: 'hero_macbook_air_m5',
    composition: 'Two open sky-blue MacBook Air laptops in an arrow formation; pale-blue background.' },
  { name: 'ipad-air', page: '/ge/', stem: 'hero_ipad_air_m4',
    composition: 'Floating iPad Air models, front and back; pale-blue background.' },
  { name: 'macbook-pro', page: '/ge/', stem: 'promo_macbook_pro',
    composition: 'MacBook Pro laptops forming a V; black background.' },
  { name: 'airpods-pro', page: '/ge/', stem: 'promo_airpods_pro_3',
    composition: 'Two white AirPods Pro 3 earbuds; light background.' },
  { name: 'watch-series-11', page: '/ge/', stem: 'promo_apple_watch_series_11',
    composition: 'Rose-gold Series 11, starlight Sport Band, Sleep Score watch face; light background.' },
  { name: 'ipad-pro', page: '/ipad-pro/', stem: 'hero_endframe', path: '/overview/hero/',
    composition: 'iPad Pro product-page hero end frame; black background.' },
  { name: 'trade-in', page: '/ca/', stem: 'promo_iphone_tradein',
    composition: 'Hands exchanging a cased iPhone 17 Pro for a boxed burgundy iPhone 18 Pro; light background.' },
  { name: 'apple-card', page: '/', stem: 'promo_apple_card',
    composition: 'Titanium Apple Card with cardholder name and chip; light background.' },
];

function appleURL(value, base = ORIGIN) {
  const url = new URL(value, base);
  if (url.protocol !== 'https:' || url.hostname !== 'www.apple.com' || url.port || url.username || url.password) {
    throw new Error(`Non-Apple URL rejected: ${url.href}`);
  }
  return url;
}

async function download(value, expectedType) {
  const original = appleURL(value);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let url = original;
      const signal = AbortSignal.timeout(LIMITS.timeout);
      for (let redirects = 0; redirects <= 4; redirects++) {
        if (++requests > LIMITS.requests) throw new Error('Request budget exceeded');
        const response = await fetch(url, {
          redirect: 'manual', signal,
          headers: { 'User-Agent': 'AppleHomepageAssetFetcher/1.0', Accept: expectedType },
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel();
          const location = response.headers.get('location');
          if (!location) throw new Error(`Redirect missing Location: ${url}`);
          url = appleURL(location, url);
          continue;
        }
        const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (response.status !== 200 || contentType !== expectedType) {
          await response.body?.cancel();
          throw new Error(`Expected 200 ${expectedType}; got ${response.status} ${contentType}: ${url}`);
        }
        const maxBytes = expectedType === 'text/html' ? 4 * 1024 ** 2 : LIMITS.file;
        if (Number(response.headers.get('content-length')) > maxBytes) {
          await response.body?.cancel();
          throw new Error(`Content-Length exceeds file budget: ${url}`);
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          received += chunk.length;
          if (size > maxBytes || received > LIMITS.total) throw new Error('Download byte budget exceeded');
          chunks.push(chunk);
        }
        return { data: Buffer.concat(chunks), status: response.status, contentType, source: url.href };
      }
      throw new Error(`Redirect limit exceeded: ${original}`);
    } catch (error) {
      if (attempt === 1 || /budget|Non-Apple/.test(error.message)) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

function jpegInfo(data) {
  if (data.length < 12 || data.readUInt16BE(0) !== 0xffd8 || data.readUInt16BE(data.length - 2) !== 0xffd9) {
    throw new Error('Invalid JPEG signature/end marker (HTML and other formats are rejected)');
  }
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 4 < data.length) {
    if (data[offset++] !== 0xff) throw new Error('Invalid JPEG marker');
    while (data[offset] === 0xff) offset++;
    const marker = data[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) throw new Error('Truncated JPEG segment');
    if (frameMarkers.has(marker)) {
      if (length < 8) throw new Error('Invalid JPEG frame');
      const height = data.readUInt16BE(offset + 3);
      const width = data.readUInt16BE(offset + 5);
      if (width < 500 || height < 400 || width * height > 50000000) throw new Error(`Unexpected dimensions: ${width}x${height}`);
      return { format: 'jpeg', width, height, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
    }
    offset += length;
  }
  throw new Error('JPEG dimensions not found');
}

function references(html, page) {
  const paths = [...html.matchAll(/(?:https:\/\/www\.apple\.com)?\/[^\s"'<>(),]+\.jpg\b/g)].map(match => match[0]);
  return [...new Set(paths.map(path => new URL(path, page))
    .filter(url => url.origin === ORIGIN).map(url => appleURL(url).href))];
}

async function existing(url) {
  try { return await readFile(url); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function verify() {
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  if (manifest.generatedBy !== GENERATED_BY || manifest.images.length !== PRODUCTS.length * 2) throw new Error('Unexpected manifest');
  const expected = PRODUCTS.flatMap(product => [`${product.name}.jpg`, `${product.name}-mobile.jpg`]);
  if (new Set(manifest.images.map(image => image.filename)).size !== expected.length) throw new Error('Duplicate manifest entries');
  for (const filename of expected) {
    const image = manifest.images.find(entry => entry.filename === filename);
    if (!image || image.httpStatus !== 200 || image.contentType !== 'image/jpeg') throw new Error(`Invalid provenance: ${filename}`);
    appleURL(image.source);
    const info = jpegInfo(await readFile(new URL(filename, DIRECTORY)));
    for (const key of ['format', 'width', 'height', 'bytes', 'sha256']) {
      if (info[key] !== image[key]) throw new Error(`Manifest mismatch: ${filename} (${key})`);
    }
    console.log(`VERIFIED ${filename} ${info.width}x${info.height} JPEG ${info.bytes} bytes`);
  }
  console.log(`Verified ${expected.length} local JPEGs against recorded HTTP 200 provenance and SHA-256 hashes.`);
}

async function acquire() {
  if (!(await stat(DIRECTORY)).isDirectory()) throw new Error('assets/ must already exist');
  const pages = new Map();
  for (const page of new Set(PRODUCTS.map(product => product.page))) {
    const result = await download(new URL(page, ORIGIN), 'text/html');
    pages.set(page, references(result.data.toString('utf8'), result.source));
  }
  const tasks = PRODUCTS.flatMap(product => ['desktop', 'mobile'].map(variant => {
    const suffix = variant === 'desktop' ? '_large_2x.jpg' : '_small_2x.jpg';
    const matches = pages.get(product.page).filter(url =>
      new URL(url).pathname.split('/').pop().startsWith(`${product.stem}__`) &&
      url.endsWith(suffix) && (!product.path || url.includes(product.path)));
    if (matches.length !== 1) throw new Error(`Expected one live ${variant} URL for ${product.name}; found ${matches.length}`);
    return { ...product, variant, url: matches[0], filename: `${product.name}${variant === 'mobile' ? '-mobile' : ''}.jpg` };
  }));

  // Three workers, at most two attempts/request; validate everything before writing.
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      const result = await download(task.url, 'image/jpeg');
      const info = jpegInfo(result.data);
      const destination = new URL(task.filename, DIRECTORY);
      const previous = await existing(destination);
      if (previous && !previous.equals(result.data)) throw new Error(`Refusing to overwrite differing file: ${task.filename}`);
      results.push({ task, result, info, destination, previous });
      console.log(`HTTP 200 image/jpeg ${task.filename} ${info.width}x${info.height} ${info.bytes} bytes`);
    }
  }));
  results.sort((a, b) => tasks.indexOf(a.task) - tasks.indexOf(b.task));
  const manifest = {
    generatedBy: GENERATED_BY, acquiredAt: new Date().toISOString(),
    notes: 'Unmodified Apple 2x JPEGs discovered in live HTML. Use mobile variants at <=734px. No headline/logo overlays downloaded.',
    images: results.map(({ task, result, info }) => ({
      filename: task.filename, product: task.name, variant: task.variant, ...info,
      source: result.source, discoveredOn: new URL(task.page, ORIGIN).href,
      httpStatus: result.status, contentType: result.contentType, composition: task.composition,
    })),
  };
  const previousManifest = await existing(MANIFEST);
  if (previousManifest) {
    const previous = JSON.parse(previousManifest.toString('utf8'));
    if (previous.generatedBy !== GENERATED_BY || JSON.stringify(previous.images) !== JSON.stringify(manifest.images)) {
      throw new Error('Refusing to overwrite a differing assets/apple-assets.json');
    }
  }
  for (const { destination, result, previous } of results) {
    if (!previous) await writeFile(destination, result.data, { flag: 'wx' });
  }
  if (!previousManifest) await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  console.log(`Ready: ${results.length} JPEGs; ${requests} requests; ${(received / 1024 ** 2).toFixed(2)} MiB received.`);
  console.log(`Manifest: ${fileURLToPath(MANIFEST)}`);
}

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('node tools/fetch-assets.mjs          Fetch 9 desktop/mobile pairs from 4 fixed Apple pages.\nnode tools/fetch-assets.mjs --verify Verify local JPEG signatures, dimensions and SHA-256 offline.\nExisting differing files are never overwritten. Limits: 3 workers, 2 attempts, 25s/request, 64 requests, 12 MiB/file, 100 MiB total.');
  } else if (args.length === 1 && args[0] === '--verify') {
    await verify();
  } else if (args.length === 0) {
    await acquire();
  } else {
    throw new Error('Usage: node tools/fetch-assets.mjs [--verify|--help]');
  }
} catch (error) {
  console.error(`Asset acquisition failed: ${error.message}`);
  process.exitCode = 1;
}
