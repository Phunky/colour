#!/usr/bin/env node
'use strict';
/*
 * Renders the native library and the compiled compatibility CSS in real
 * browsers (via Playwright) and compares the computed colours.
 *
 * Chromium: native vs compat must match for every case and in both demos.
 * WebKit: the compat build must match Chromium's rendering; native support
 * is reported but not required.
 */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium, webkit } = require('playwright');
const { createCompiler } = require('./compiler.cjs');

const root = path.resolve(__dirname, '..');
const colourSource = fs.readFileSync(path.join(root, 'src/colour.css'), 'utf8');
const { compileValue, palette, accent } = createCompiler(colourSource);
const TOLERANCE = 2;

const AMOUNTS = {
  lighten: '10', darken: '15', saturate: '20', desaturate: '30', 'adjust-hue': '90',
  tint: '25%', shade: '30%', rgba: '0.5', opacity: '0.5', accent: '700',
};
const COLOURS = [null, 'currentColor', 'blue', 'red', '#6750a4', 'rgb(255, 87, 34)', 'hsl(120 50% 50%)',
  'oklch(60% 0.2 250)', 'rebeccapurple', 'var(--brand)', 'var(--missing, hsl(10 80% 50%))'];

const cases = [];
const add = (expr, property = 'background-color') => cases.push({ expr, property });
for (const name of palette.keys()) add(`--colour(${name})`);
for (const colour of COLOURS) add(colour === null ? '--colour()' : `--colour(${colour})`);
for (const [name, amount] of Object.entries(AMOUNTS)) {
  for (const colour of COLOURS) add(colour === null ? `--colour-${name}(${amount})` : `--colour-${name}(${amount}, ${colour})`);
}
for (const level of accent.keys()) add(`--colour-accent(${level}, red)`);
for (const level of accent.keys()) add(`--colour-accent(${level})`);
[
  '--colour-opacity(0.8, --colour-lighten(15, blue))',
  '--colour-opacity(0.8, --colour-saturate(20, --colour-darken(10, blue)))',
  '--colour-opacity(0.5, --colour-lighten(20))',
  '--colour-rgba(0.5, --colour-opacity(0.5, red))',
  '--colour-lighten(10, --colour(red))',
  '--colour-adjust-hue(30, --colour-accent(700, --colour-tint(10%, color-mix(in srgb, --colour(red), --colour(amber) 40%))))',
  '--colour-tint(20%, color-mix(in srgb, --colour-darken(10, teal), --colour-lighten(10, pink)))',
  '--colour-opacity(0.9, --colour-saturate(10, --colour-darken(5, --colour-adjust-hue(20, --colour-tint(10%, --colour-shade(5%, --colour-accent(300, red)))))))',
  '--colour-rgba(0.9, --colour-accent(300, --colour-adjust-hue(45)))',
  '--colour-desaturate(40, var(--missing, rgb(255, 87, 34)))',
  '--colour-lighten(10, var(--brand))',
].forEach(expr => add(expr));
add('--colour-darken(30)', 'color');
add('--colour-opacity(0.5, --colour-lighten(20))', 'color');

// Valid by the spec, but Chromium currently rejects a function nested in its own
// argument chain (w3c/csswg-drafts#13943, crbug.com/514021797).
const selfNested = [
  '--colour(--colour(red))',
  '--colour-lighten(10, --colour-lighten(10, red))',
  '--colour-opacity(0.5, --colour-lighten(10, --colour-opacity(0.5, red)))',
];

function fixture(mode, list) {
  const rules = list.map((c, i) => `#c${i} { ${c.property}: ${mode === 'native' ? c.expr : compileValue(c.expr)}; }`).join('\n');
  const body = list.map((_, i) => `<div id="c${i}"></div>`).join('');
  return `<!doctype html><style>${mode === 'native' ? colourSource : ''}
.scope { color: rgb(30, 120, 200); --brand: #00897b; }
.scope > div { width: 4px; height: 4px; }
${rules}</style><div class="scope">${body}</div>`;
}

// Normalises any computed colour serialisation to 8-bit RGBA via a canvas.
async function readColours(page, selectors) {
  return page.evaluate(items => {
    const ctx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
    return items.map(([selector, property, pseudo]) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const value = getComputedStyle(el, pseudo || null).getPropertyValue(property);
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      return { value, rgba: [...ctx.getImageData(0, 0, 1, 1).data] };
    });
  }, selectors);
}

const close = (a, b) => a && b && a.rgba.every((v, i) => Math.abs(v - b.rgba[i]) <= TOLERANCE);
const fmt = c => c ? `rgba(${c.rgba.join(', ')}) from "${c.value}"` : 'missing';
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

const INK_A = 'rgb(30, 120, 200)';
// Light enough that accents 900/1000 do not clamp both inks to black.
const INK_B = 'rgb(250, 170, 190)';

// Returns fresh renders with each inherited colour, plus a live update from INK_A to INK_B.
async function renderCases(browser, mode, list) {
  const page = await browser.newPage();
  const selectors = list.map((c, i) => [`#c${i}`, c.property]);
  const fresh = [];
  for (const ink of [INK_A, INK_B]) {
    await page.setContent(fixture(mode, list).replace('<div class="scope">', `<div class="scope" style="color: ${ink}">`));
    fresh.push(await readColours(page, selectors));
  }
  await page.setContent(fixture(mode, list));
  await page.evaluate(c => { document.querySelector('.scope').style.color = c; }, INK_B);
  const live = await readColours(page, selectors);
  await page.close();
  return { fresh, live };
}

// Chromium does not recompute `color: <relative colour or color-mix() from currentColor>`
// when only the inherited color changes; a fresh render is correct.
function checkLiveUpdates(result, label, { allowStaleColorProperty = false } = {}) {
  const stale = cases.filter((_, i) => !close(result.live[i], result.fresh[1][i]));
  const tolerated = stale.filter(c => allowStaleColorProperty && c.property === 'color');
  stale.filter(c => !tolerated.includes(c)).forEach(c => check(false, `${label}: live currentColor update is stale for ${c.property}: ${c.expr}`));
  return tolerated;
}

const failuresSince = start => failures.length - start ? `${failures.length - start} MISMATCHES` : 'all equivalent';

async function testFixtures(chrome, safari) {
  let start = failures.length;
  const [native, compat] = await Promise.all([renderCases(chrome, 'native', cases), renderCases(chrome, 'compat', cases)]);
  cases.forEach((c, i) => native.fresh.forEach((run, r) => {
    check(close(run[i], compat.fresh[r][i]), `Chromium native vs compat (ink ${r}) ${c.property}: ${c.expr}\n    native ${fmt(run[i])}\n    compat ${fmt(compat.fresh[r][i])}`);
  }));
  const usesCurrentColor = c => c.property === 'color' || /currentColor|--colour(-[\w-]+)?\(([\d.]+%?)?\)/.test(c.expr);
  cases.forEach((c, i) => {
    const changed = !close(native.fresh[0][i], native.fresh[1][i]);
    check(changed === usesCurrentColor(c), `${c.property}: ${c.expr} should ${usesCurrentColor(c) ? '' : 'not '}follow the inherited color`);
  });
  checkLiveUpdates(native, 'Chromium native');
  const staleCompat = checkLiveUpdates(compat, 'Chromium compat', { allowStaleColorProperty: true });
  console.log(`Chromium ${chrome.version()}: ${cases.length} cases × 2 inherited colours, native vs compat ${failuresSince(start)}; ${cases.filter(usesCurrentColor).length} cases follow currentColor.`);
  if (staleCompat.length) {
    console.log(`Known Chromium bug: compat \`color: …currentColor…\` is not recomputed on a live inherited color change (${staleCompat.length} cases); fresh renders are correct.`);
  }

  const nested = selfNested.map(expr => ({ expr, property: 'background-color' }));
  const nestedCompat = (await renderCases(chrome, 'compat', nested)).fresh[0];
  check(nestedCompat.every(c => c.rgba[3] > 0), 'Compat build must compile self-nested calls');
  const reportSelfNesting = async (browser, engine) => {
    const results = (await renderCases(browser, 'native', nested)).fresh[0];
    const broken = selfNested.length - selfNested.filter((_, i) => close(results[i], nestedCompat[i])).length;
    console.log(broken
      ? `Known ${engine} limitation: ${broken}/${selfNested.length} self-nested calls (e.g. --colour-lighten(10, --colour-lighten(10, red))) are invalid natively; the compat build handles them.`
      : `${engine} supports self-nested calls natively.`);
  };
  await reportSelfNesting(chrome, 'Chromium');

  if (!safari) return;
  start = failures.length;
  const [webkitCompat, webkitNative] = await Promise.all([renderCases(safari, 'compat', cases), renderCases(safari, 'native', cases)]);
  cases.forEach((c, i) => webkitCompat.fresh.forEach((run, r) => {
    check(close(run[i], compat.fresh[r][i]), `WebKit compat vs Chromium (ink ${r}) ${c.property}: ${c.expr}\n    webkit ${fmt(run[i])}\n    chromium ${fmt(compat.fresh[r][i])}`);
  }));
  checkLiveUpdates(webkitCompat, 'WebKit compat');
  const nativeMatches = cases.filter((_, i) => webkitNative.fresh.every((run, r) => close(run[i], native.fresh[r][i]))).length;
  console.log(`WebKit ${safari.version()}: compat vs Chromium ${failuresSince(start)} (${cases.length} cases); native @function matches Chromium in ${nativeMatches}/${cases.length} cases (informational).`);
  await reportSelfNesting(safari, 'WebKit');
}

const TONES = ['red', 'blue', 'teal', 'amber', 'black', 'white', 'deep-purple', 'currentColor'];
const INKS = ['blue', 'red', 'amber'];
async function sampleDemo(page) {
  const selectors = await page.evaluate(() => {
    const out = [];
    const tag = (el, i) => { el.setAttribute(`data-probe-${i}`, ''); return `[data-probe-${i}]`; };
    let n = 0;
    document.querySelectorAll('.operation-swatch, .accent-swatch, .runtime-spheres i, .example-button, .example-alert, .tone-dot')
      .forEach(el => out.push([tag(el, n++), 'background-color']));
    document.querySelectorAll('[data-fn="rgba"] .operation-swatch, [data-fn="opacity"] .operation-swatch, .compose-swatch')
      .forEach(el => out.push([tag(el, n++), 'background-color', '::before']));
    document.querySelectorAll('.example-alert, .ink-option').forEach(el => out.push([tag(el, n++), 'color']));
    return out;
  });
  return readColours(page, selectors).then(values => values.map((v, i) => ({ v, at: selectors[i] })));
}

async function renderDemo(browser, file) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(pathToFileURL(path.join(root, 'dist', file)).href);
  const states = [];
  for (const tone of TONES) {
    await page.click(`label:has(#tone-${tone})`);
    for (const ink of tone === 'currentColor' ? INKS : [INKS[0]]) {
      await page.click(`label[for="ink-${ink}"]`);
      states.push({ name: `${tone}/${ink}`, samples: await sampleDemo(page) });
    }
  }
  await page.close();
  return states;
}

async function testDemos(chrome, safari) {
  let start = failures.length;
  const native = await renderDemo(chrome, 'index-native.html');
  const compat = await renderDemo(chrome, 'index.html');
  const compare = (a, b, label) => a.forEach((state, s) => state.samples.forEach((sample, i) => {
    const other = b[s].samples[i];
    check(close(sample.v, other.v), `${label} demo ${state.name} ${sample.at.join(' ')}\n    ${fmt(sample.v)}\n    ${fmt(other.v)}`);
  }));
  compare(native, compat, 'Chromium native vs compat');
  const swatchesChange = (a, b) => a.samples.some((s, i) => !close(s.v, b.samples[i].v));
  check(swatchesChange(compat[0], compat[1]), 'Demo swatches must change with the palette selection');
  const current = compat.filter(s => s.name.startsWith('currentColor/'));
  check(swatchesChange(current[0], current[1]) && swatchesChange(current[1], current[2]), 'currentColor demo must follow the ink selection');
  const transparent = compat[0].samples.filter(s => s.v.rgba[3] === 0).map(s => s.at.join(' '));
  check(transparent.length === 0, `Demo swatches rendered transparent: ${transparent.join(', ')}`);
  console.log(`Chromium demo: ${native.length} palette/ink states × ${native[0].samples.length} swatches, native vs compat ${failuresSince(start)}.`);

  if (!safari) return;
  start = failures.length;
  const webkitCompat = await renderDemo(safari, 'index.html');
  compare(webkitCompat, compat, 'WebKit vs Chromium compat');
  console.log(`WebKit demo: compat landing page vs Chromium ${failuresSince(start)} (${webkitCompat.length} states).`);
}

(async () => {
  const chrome = await chromium.launch();
  let safari = null;
  try {
    safari = await webkit.launch();
  } catch (error) {
    console.warn(`WebKit unavailable, compatibility build NOT verified in WebKit: ${error.message.split('\n')[0]}`);
    if (process.env.CI) failures.push('WebKit is required in CI');
  }
  try {
    await testFixtures(chrome, safari);
    await testDemos(chrome, safari);
  } finally {
    await chrome.close();
    if (safari) await safari.close();
  }
  if (failures.length) {
    console.error(`\n${failures.length} browser check(s) failed:\n- ${failures.slice(0, 40).join('\n- ')}`);
    process.exit(1);
  }
  console.log('Browser checks passed.');
})().catch(error => { console.error(error); process.exit(1); });
