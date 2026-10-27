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
const { createCompiler, luminance, contrastRatio, toOklch } = require('./compiler.cjs');

const root = path.resolve(__dirname, '..');
const colourSource = fs.readFileSync(path.join(root, 'src/colour.css'), 'utf8');
const { compileValue, compileFallback, staticColour, palette, accent } = createCompiler(colourSource);
const TOLERANCE = 2;

const AMOUNTS = {
  lighten: '10', darken: '15', saturate: '20', desaturate: '30', 'adjust-hue': '90',
  tint: '25%', shade: '30%', rgba: '0.5', opacity: '0.5', accent: '700',
  fade: '0.5', tone: '35%', chroma: '0.5',
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

const MIX_COLOURS = ['red', 'blue', 'white', 'black', 'grey', 'currentColor', '#6750a4', 'oklch(60% 0.2 250)', 'var(--brand)', 'rgb(255 87 34 / 50%)', 'transparent'];
for (const a of MIX_COLOURS) for (const b of ['blue', 'amber', 'currentColor', 'white']) if (a !== b) add(`--colour-mix(30%, ${a}, ${b})`);
for (const weight of ['0%', '50%', '100%']) add(`--colour-mix(${weight}, red, blue)`);
for (const tone of ['0%', '25%', '50%', '75%', '100%']) add(`--colour-tone(${tone}, blue-grey)`);
for (const chroma of ['0', '0.25', '1', '1.5', '3']) add(`--colour-chroma(${chroma}, teal)`);
for (const fade of ['0', '0.5', '1', '3']) add(`--colour-fade(${fade}, --colour-opacity(0.6, blue))`);
[
  '--colour-tone(85%, blue)',
  '--colour-tone(60%)',
  '--colour-chroma(0.8)',
  '--colour-fade(0.5)',
  '--colour-mix(50%, #ff0000, currentColor)',
  '--colour-mix(40%, --colour-lighten(10, purple), --colour-darken(10, blue))',
  '--colour-tone(70%, --colour-chroma(0.8, --colour-mix(40%, purple, blue)))',
  '--colour-darken(15, --colour-tone(70%, --colour-chroma(0.8, --colour-mix(40%, purple, blue))))',
  '--colour-tone(65%, --colour-mix(35%, blue, purple))',
  '--colour-fade(0.4, --colour-tone(65%, --colour-mix(35%, blue, purple)))',
  '--colour-fade(0.8, --colour-tone(55%, --colour-mix(25%, currentColor, amber)))',
  '--colour-mix(50%, color-mix(in srgb, --colour(red), --colour(amber) 40%), --colour-chroma(0.5, var(--missing, rgb(0, 128, 255))))',
  '--colour-chroma(0.5, --colour-tone(40%, --colour-fade(0.5, --colour-adjust-hue(30, --colour-tint(10%, --colour-accent(700, red))))))',
  '--colour-mix(25%, --colour-fade(0.5, red), --colour-tone(30%, --colour-chroma(0.5, var(--brand))))',
  'light-dark(--colour(white), --colour-tone(25%, blue-grey))',
  '--colour-tone(30%, light-dark(--colour(amber), --colour(indigo)))',
].forEach(expr => add(expr));
add('--colour-tone(30%)', 'color');
add('--colour-mix(50%, currentColor, white)', 'color');

// Behaviour every engine must show, beyond native/compat equivalence.
const toUnit = c => ({ r: c.rgba[0] / 255, g: c.rgba[1] / 255, b: c.rgba[2] / 255, alpha: c.rgba[3] / 255 });
const PROPERTIES = [
  ['--colour-fade(0.5, --colour-opacity(0.6, blue))', c => Math.abs(c.rgba[3] - 76.5) <= 1, 'fade multiplies alpha: 0.6 × 0.5 = 0.3'],
  ['--colour-fade(3, --colour-opacity(0.6, blue))', c => c.rgba[3] === 255, 'fade clamps alpha at 1'],
  ['--colour-fade(0, --colour-opacity(0.6, blue))', c => c.rgba[3] === 0, 'fade 0 is fully transparent'],
  ['--colour-opacity(0.5, --colour-fade(0.2, blue))', c => Math.abs(c.rgba[3] - 127.5) <= 1, 'opacity replaces a faded alpha'],
  ['--colour-chroma(0, blue)', c => Math.max(...c.rgba.slice(0, 3)) - Math.min(...c.rgba.slice(0, 3)) <= 1, 'chroma 0 is grey'],
  ['--colour-chroma(0, blue)', c => Math.abs(toOklch(toUnit(c)).l - toOklch(staticColour('--colour(blue)')).l) < 0.01, 'chroma keeps lightness'],
  ['--colour-tone(30%, blue-grey)', c => Math.abs(toOklch(toUnit(c)).l - 0.3) < 0.01, 'tone sets OKLCH lightness to 30%'],
  ['--colour-tone(60%, --colour-opacity(0.5, blue-grey))', c => Math.abs(c.rgba[3] - 127.5) <= 1, 'tone keeps alpha'],
  ['--colour-tone(0%, grey)', c => c.rgba.slice(0, 3).every(v => v <= 1), 'tone 0% of a neutral colour is black'],
  ['--colour-tone(100%, grey)', c => c.rgba.slice(0, 3).every(v => v >= 254), 'tone 100% of a neutral colour is white'],
  ['--colour-tone(0%, --colour-chroma(0, blue))', c => c.rgba.slice(0, 3).every(v => v <= 1), 'tone 0% without chroma is black'],
  // Browsers currently clip out-of-gamut OKLCH rather than gamut-map it, so a saturated
  // colour keeps a tint at the extremes; only the direction is guaranteed.
  ['--colour-tone(5%, blue)', c => toOklch(toUnit(c)).l < 0.2, 'tone 5% of blue is very dark'],
  ['--colour-tone(98%, blue)', c => toOklch(toUnit(c)).l > 0.9, 'tone 98% of blue is near white'],
  ['--colour-mix(0%, red, blue)', c => close(c, { rgba: [244, 67, 54, 255] }), 'mix 0% is the first colour'],
  ['--colour-mix(100%, red, blue)', c => close(c, { rgba: [33, 150, 243, 255] }), 'mix 100% is the second colour'],
  ['--colour-mix(50%, white, blue)', c => Math.abs(toOklch(toUnit(c)).h - toOklch(staticColour('--colour(blue)')).h) < 1, 'white has no hue, so the mix keeps blue\'s hue'],
  ['--colour-tone(85%, blue)', c => c.rgba[3] === 255, 'an out-of-gamut tone still renders as an opaque colour'],
];

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

// Canvas readback is premultiplied, so colour channels lose precision as alpha drops.
const close = (a, b) => {
  if (!a || !b) return false;
  const alpha = Math.min(a.rgba[3], b.rgba[3]);
  if (alpha === 0) return Math.abs(a.rgba[3] - b.rgba[3]) <= TOLERANCE;
  const channelTolerance = TOLERANCE * Math.max(1, 255 / alpha);
  return a.rgba.every((v, i) => Math.abs(v - b.rgba[i]) <= (i === 3 ? TOLERANCE : channelTolerance));
};
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

async function checkProperties(browser, engine, { native = true } = {}) {
  const start = failures.length;
  const list = PROPERTIES.map(([expr]) => ({ expr, property: 'background-color' }));
  for (const mode of native ? ['native', 'compat'] : ['compat']) {
    const values = (await renderCases(browser, mode, list)).fresh[0];
    PROPERTIES.forEach(([expr, predicate, label], i) => check(predicate(values[i]), `${engine} ${mode}: ${label}: ${expr} gave ${fmt(values[i])}`));
  }
  console.log(`${engine} behaviour (${native ? 'native and compat' : 'compat'}): ${PROPERTIES.length} checks of alpha, tone, chroma and mix ${failuresSince(start) === 'all equivalent' ? 'pass' : failuresSince(start)}.`);
  const extremes = ['--colour-tone(0%, blue)', '--colour-tone(100%, blue)', '--colour-chroma(3, teal)'];
  const shown = (await renderCases(browser, 'compat', extremes.map(expr => ({ expr, property: 'background-color' })))).fresh[0];
  console.log(`  Out-of-gamut rendering (informational, ${engine} clips): ${extremes.map((e, i) => `${e} → rgb(${shown[i].rgba.slice(0, 3).join(', ')})`).join('; ')}`);
}

// Feature detection, so nothing is asserted for a feature an engine lacks.
async function features(browser) {
  const page = await browser.newPage();
  await page.setContent('<style>@function --probe() returns <color> { result: rgb(1, 2, 3); } #p { color: --probe(); }</style><div id="p"></div>');
  const result = await page.evaluate(() => ({
    customFunctions: getComputedStyle(document.getElementById('p')).color === 'rgb(1, 2, 3)',
    contrastColor: CSS.supports('color', 'contrast-color(red)'),
    lightDark: CSS.supports('color', 'light-dark(red, blue)'),
    relativeOklch: CSS.supports('color', 'oklch(from red l c h)'),
    mixOklch: CSS.supports('color', 'color-mix(in oklch, red, blue)'),
  }));
  await page.close();
  return result;
}

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

  // Build-time colours (which drive the static contrast fallbacks) must match the browser's rendering.
  const staticStart = failures.length;
  const statics = cases.map((c, i) => ({ c, i, s: staticColour(c.expr) })).filter(({ s }) => s);
  for (const { c, i, s } of statics) {
    const rendered = native.fresh[0][i].rgba;
    // Canvas readback stores premultiplied colour, so channels lose precision as alpha drops.
    const tolerance = TOLERANCE + (s.alpha < 1 ? 2 / Math.max(s.alpha, 0.1) : 0);
    const ok = s.alpha === 0 ? rendered[3] === 0 : [s.r, s.g, s.b, s.alpha].every((v, k) => Math.abs(v * 255 - rendered[k]) <= (k === 3 ? 1 : tolerance));
    check(ok, `Compiler static evaluation differs from Chromium for ${c.expr}: [${[s.r, s.g, s.b, s.alpha].map(v => Math.round(v * 255)).join(', ')}] vs ${fmt(native.fresh[0][i])}`);
  }
  console.log(`Compiler static evaluation: ${statics.length} build-time colours (HSL, sRGB, OKLCH, alpha) vs Chromium ${failuresSince(staticStart)}.`);
  await checkProperties(chrome, 'Chromium');
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
  await checkProperties(safari, 'WebKit', { native: false });
  const nativeMatches = cases.filter((_, i) => webkitNative.fresh.every((run, r) => close(run[i], native.fresh[r][i]))).length;
  console.log(`WebKit ${safari.version()}: compat vs Chromium ${failuresSince(start)} (${cases.length} cases); native @function matches Chromium in ${nativeMatches}/${cases.length} cases (informational).`);
  await reportSelfNesting(safari, 'WebKit');
}

const contrastBackgrounds = [
  ...palette.keys(),
  '#767676', '#757575', '#6750a4', '#fafafa', '#101010', 'rgb(250, 250, 250)', 'hsl(240 100% 20%)',
  'oklch(85% 0.1 200)', 'oklch(30% 0.1 30)', 'var(--brand)', 'var(--missing, #ffeb3b)',
  '--colour-darken(15, blue)', '--colour-lighten(30, --colour-darken(10, indigo))', '--colour-tint(85%, deep-purple)',
  '--colour-shade(70%, yellow)', '--colour-accent(900, amber)', '--colour-accent(50, indigo)',
  '--colour-opacity(0.8, --colour-lighten(20, red))', '--colour-opacity(0.2, black)',
];
const REPRESENTATIVE = ['yellow', 'blue', 'indigo', 'grey', '#767676', '--colour-darken(15, blue)', '--colour-opacity(0.2, black)'];

async function renderContrast(browser, mode) {
  const value = bg => {
    const expr = `--colour-contrast(${bg})`;
    if (mode === 'native') return expr;
    if (mode === 'fallback') return compileFallback(expr) ?? 'transparent';
    return compileValue(expr);
  };
  const rules = contrastBackgrounds.map((bg, i) => {
    const background = mode === 'native' ? (bg.startsWith('--') ? bg : `--colour(${bg})`) : compileValue(bg.startsWith('--') ? bg : `--colour(${bg})`);
    return `#k${i} { background-color: ${background}; color: ${value(bg)}; }`;
  }).join('\n');
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><style>${mode === 'native' ? colourSource : ''} body { color: rgb(200, 0, 200); --brand: #00897b; }\n${rules}</style>`
    + contrastBackgrounds.map((_, i) => `<div id="k${i}">Aa</div>`).join(''));
  const selectors = contrastBackgrounds.flatMap((_, i) => [[`#k${i}`, 'background-color'], [`#k${i}`, 'color']]);
  const values = await readColours(page, selectors);
  await page.close();
  return contrastBackgrounds.map((bg, i) => ({ bg, background: values[2 * i], text: values[2 * i + 1] }));
}

const srgb = c => ({ r: c.rgba[0] / 255, g: c.rgba[1] / 255, b: c.rgba[2] / 255 });
const isBlackOrWhite = c => c.rgba[3] === 255 && c.rgba.slice(0, 3).every(v => v === c.rgba[0]) && (c.rgba[0] === 0 || c.rgba[0] === 255);

async function testContrast(chrome, safari) {
  const start = failures.length;
  for (const [engine, browser] of [['Chromium', chrome], ['WebKit', safari]].filter(([, b]) => b)) {
    const [native, compat, fallback] = await Promise.all(['native', 'compat', 'fallback'].map(m => renderContrast(browser, m)));
    native.forEach((n, i) => {
      check(isBlackOrWhite(n.text), `${engine}: --colour-contrast(${n.bg}) should be black or white, got ${fmt(n.text)}`);
      check(close(n.text, compat[i].text), `${engine}: native vs compat --colour-contrast(${n.bg})\n    ${fmt(n.text)}\n    ${fmt(compat[i].text)}`);
      check(close(n.background, compat[i].background), `${engine}: background ${n.bg}`);
      const staticFallback = compileFallback(`--colour-contrast(${n.bg})`);
      if (staticFallback !== null) {
        check(close(n.text, fallback[i].text), `${engine}: build-time WCAG fallback disagrees with contrast-color() for ${n.bg}: ${staticFallback} vs ${fmt(n.text)}`);
      }
      const bgL = luminance(srgb(n.background));
      const chosen = contrastRatio(bgL, luminance(srgb(n.text)));
      const other = contrastRatio(bgL, n.text.rgba[0] === 0 ? 1 : 0);
      check(chosen >= other - 0.01, `${engine}: ${n.bg} chose the lower-contrast option (${chosen.toFixed(2)}:1 vs ${other.toFixed(2)}:1)`);
    });
    if (engine === 'Chromium') {
      const statics = native.filter(n => compileFallback(`--colour-contrast(${n.bg})`) !== null).length;
      console.log(`Chromium contrast: ${native.length} backgrounds, native vs compat ${failuresSince(start)}; ${statics} build-time fallbacks match contrast-color().`);
      console.log('Representative WCAG 2.x ratios (alpha ignored, as contrast-color() does):');
      for (const n of native.filter(n => REPRESENTATIVE.includes(n.bg))) {
        const bgL = luminance(srgb(n.background));
        const name = n.text.rgba[0] === 0 ? 'black' : 'white';
        const over = n.background.rgba[3] < 255 ? ` — ${contrastRatio(luminance(srgb({ rgba: n.background.rgba.map((v, k) => k < 3 ? v * n.background.rgba[3] / 255 + 255 * (1 - n.background.rgba[3] / 255) : v) })), luminance(srgb(n.text))).toFixed(2)}:1 when composited over white` : '';
        console.log(`  ${n.bg.padEnd(30)} ${name} ${contrastRatio(bgL, luminance(srgb(n.text))).toFixed(2)}:1 (other: ${contrastRatio(bgL, name === 'black' ? 1 : 0).toFixed(2)}:1)${over}`);
      }
    } else {
      console.log(`WebKit contrast: ${native.length} backgrounds, native, compat and fallbacks ${failuresSince(start)}.`);
    }
  }
}

const TONES = ['red', 'blue', 'teal', 'amber', 'black', 'white', 'deep-purple', 'currentColor'];
const INKS = ['blue', 'red', 'amber'];
const MIXES = ['pink', 'amber', 'teal', 'deep-orange', 'white', 'black'];
async function sampleDemo(page) {
  const selectors = await page.evaluate(() => {
    const out = [];
    const tag = (el, i) => { el.setAttribute(`data-probe-${i}`, ''); return `[data-probe-${i}]`; };
    let n = 0;
    document.querySelectorAll('.operation-swatch, .accent-swatch, .runtime-spheres i, .example-button, .example-alert, .tone-dot, .mix-cell, .mix-option i, .tone-cell, .hsl-cell, .hue-compare i, .chroma-cell, .theme-stage, .a11y-sample, .derived-button')
      .forEach(el => out.push([tag(el, n++), 'background-color']));
    document.querySelectorAll('[data-fn="rgba"] .operation-swatch, [data-fn="opacity"] .operation-swatch, .compose-swatch, .alpha-swatch')
      .forEach(el => out.push([tag(el, n++), 'background-color', '::before']));
    document.querySelectorAll('.example-alert, .ink-option, .contrast-sample, .a11y-sample, .derived-button').forEach(el => out.push([tag(el, n++), 'color']));
    document.querySelectorAll('.contrast-sample').forEach(el => out.push([tag(el, n++), 'background-color']));
    document.querySelectorAll('.theme-card, .derived-button').forEach(el => out.push([tag(el, n++), 'border-top-color']));
    return out;
  });
  return readColours(page, selectors).then(values => values.map((v, i) => ({ v, at: selectors[i] })));
}

// Every contrast label must name the colour the text actually uses.
async function checkContrastLabels(page, label) {
  const mismatches = await page.evaluate(() => [...document.querySelectorAll('.contrast-sample')].map(el => {
    const text = el.querySelector('.contrast-label').innerText.replace(/\s+/g, ' ').trim().toLowerCase();
    const colour = getComputedStyle(el).color;
    const expected = colour === 'rgb(0, 0, 0)' ? 'black text' : colour === 'rgb(255, 255, 255)' ? 'white text' : `unexpected ${colour}`;
    return text === expected ? null : `${el.dataset.colour || el.dataset.example || el.parentElement.dataset.example}: label "${text}", colour ${colour}`;
  }).filter(Boolean));
  mismatches.forEach(m => check(false, `${label} contrast label: ${m}`));
}

async function renderDemo(browser, file) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(pathToFileURL(path.join(root, 'dist', file)).href);
  await checkContrastLabels(page, `${browser.browserType().name()} ${file}`);
  const states = [];
  for (const [t, tone] of TONES.entries()) {
    await page.click(`label:has(#tone-${tone})`);
    await page.click(`label:has(#mix-${MIXES[t % MIXES.length]})`);
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

  // Simulate an older browser: the compat CSS without its @supports (contrast-color()) blocks.
  start = failures.length;
  const runtimeExamples = ['oklch', 'custom-property', 'dynamic'];
  const nativeColours = await contrastColours(chrome, 'index-native.html');
  const legacyColours = await contrastColours(chrome, 'index.html', { legacy: true });
  check(legacyColours.size === 34, `expected 34 contrast samples, found ${legacyColours.size}`);
  for (const [name, colour] of legacyColours) {
    if (runtimeExamples.includes(name)) check(colour === 'rgb(0, 0, 0)', `Without contrast-color(), ${name} should use its declared fallback, got ${colour}`);
    else check(colour === nativeColours.get(name), `Without contrast-color(), fallback for ${name} is ${colour} but contrast-color() chooses ${nativeColours.get(name)}`);
  }
  const darkNative = await contrastColours(chrome, 'index-native.html', { scheme: 'dark' });
  const darkLegacy = await contrastColours(chrome, 'index.html', { legacy: true, scheme: 'dark' });
  for (const name of ['theme-card', 'theme-button', 'theme-badge', 'derived-button']) {
    check(darkLegacy.get(name) === darkNative.get(name), `Without contrast-color(), dark ${name} is ${darkLegacy.get(name)} but contrast-color() chooses ${darkNative.get(name)}`);
  }
  console.log(`Chromium demo without contrast-color(): ${legacyColours.size - runtimeExamples.length} fallbacks (static, light-dark() and author-declared) match native in light and dark schemes; ${runtimeExamples.length} runtime examples use their declared default — ${failuresSince(start)}.`);

  if (!safari) return;
  start = failures.length;
  const webkitCompat = await renderDemo(safari, 'index.html');
  compare(webkitCompat, compat, 'WebKit vs Chromium compat');
  console.log(`WebKit demo: compat landing page vs Chromium ${failuresSince(start)} (${webkitCompat.length} states).`);
}

// Serves dist/ from a fake origin so the CSS can be rewritten (file:// cannot be intercepted).
async function openDemo(browser, file, { legacy = false, scheme, osScheme = 'light' } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: osScheme });
  await page.route('http://demo.test/**', route => {
    const name = new URL(route.request().url()).pathname.slice(1);
    const filePath = path.join(root, 'dist', name);
    if (!fs.existsSync(filePath)) return route.fulfill({ status: 404 });
    let body = fs.readFileSync(filePath, 'utf8');
    if (legacy && name.endsWith('.css')) body = body.replaceAll('@supports (color: contrast-color(red))', '@supports (color: no-such-function(red))');
    return route.fulfill({ contentType: name.endsWith('.css') ? 'text/css' : 'text/html', body });
  });
  await page.goto(`http://demo.test/${file}`);
  if (scheme) await page.click(`label:has(#scheme-${scheme})`);
  return page;
}

async function contrastColours(browser, file, options = {}) {
  const page = await openDemo(browser, file, options);
  await checkContrastLabels(page, `${browser.browserType().name()} ${file}${options.legacy ? ' without contrast-color()' : ''}${options.scheme ? ` (${options.scheme})` : ''}`);
  const colours = new Map(await page.$$eval('.contrast-sample, .derived-button', els => els.map(el => [el.dataset.colour || el.dataset.example || el.parentElement.dataset.example || 'derived-button', getComputedStyle(el).color])));
  await page.close();
  return colours;
}

const THEME_PROBES = [
  ['.theme-stage', 'background-color'], ['.theme-card', 'background-color'], ['.theme-card', 'color'], ['.theme-card', 'border-top-color'],
  ['.theme-button', 'background-color'], ['.theme-button', 'color'], ['.theme-badge', 'background-color'], ['.theme-badge', 'color'],
];
async function themeColours(browser, file, scheme, osScheme) {
  const page = await openDemo(browser, file, { scheme, osScheme });
  await checkContrastLabels(page, `${browser.browserType().name()} ${file} ${scheme}/${osScheme}`);
  const values = await readColours(page, THEME_PROBES);
  await page.close();
  return values;
}

// CSS-only theme switch: radios set color-scheme; light-dark() and the library follow.
async function testThemes(chrome, safari) {
  const start = failures.length;
  const runs = [['light', 'dark'], ['dark', 'light'], ['system', 'light'], ['system', 'dark']];
  const engines = [['Chromium', chrome, ['index-native.html', 'index.html']], ['WebKit', safari, ['index.html']]].filter(([, b]) => b);
  const results = {};
  for (const [engine, browser, files] of engines) {
    for (const file of files) {
      for (const [scheme, os] of runs) results[`${engine} ${file} ${scheme}/${os}`] = await themeColours(browser, file, scheme, os);
    }
  }
  const same = (a, b, label) => THEME_PROBES.forEach((probe, i) => check(close(results[a][i], results[b][i]), `${label} ${probe.join(' ')}: ${fmt(results[a][i])} vs ${fmt(results[b][i])}`));
  for (const run of runs.map(r => r.join('/'))) {
    same(`Chromium index-native.html ${run}`, `Chromium index.html ${run}`, `Theme ${run} native vs compat`);
    if (safari) same(`WebKit index.html ${run}`, `Chromium index.html ${run}`, `Theme ${run} WebKit vs Chromium compat`);
  }
  same('Chromium index.html system/light', 'Chromium index.html light/dark', 'System scheme with a light OS should match Light');
  same('Chromium index.html system/dark', 'Chromium index.html dark/light', 'System scheme with a dark OS should match Dark');
  const light = results['Chromium index.html light/dark'];
  const dark = results['Chromium index.html dark/light'];
  THEME_PROBES.forEach((probe, i) => check(!close(light[i], dark[i]), `Theme switch should change ${probe.join(' ')}`));
  check(light[2].value === 'rgb(0, 0, 0)' && dark[2].value === 'rgb(255, 255, 255)', `Theme card text should be black in light and white in dark, got ${light[2].value} / ${dark[2].value}`);
  console.log(`Theme switch: light, dark and system (OS light/dark) × native/compat${safari ? ' + WebKit' : ''}, ${THEME_PROBES.length} colours each — ${failuresSince(start)}.`);
}

// The generated accessibility table: rendered colours must reproduce the build-time ratios.
async function checkAccessibility(browser, file, options = {}) {
  const page = await openDemo(browser, file, options);
  const rows = await page.$$eval('tr[data-background]', trs => trs.map((tr, i) => {
    tr.querySelector('.a11y-sample').setAttribute('data-a11y', i);
    return { background: tr.dataset.background, text: tr.dataset.text, ratio: tr.dataset.ratio && Number(tr.dataset.ratio) };
  }));
  const values = await readColours(page, rows.flatMap((_, i) => [[`[data-a11y="${i}"]`, 'background-color'], [`[data-a11y="${i}"]`, 'color']]));
  await page.close();
  const label = `${browser.browserType().name()} ${file}${options.legacy ? ' without contrast-color()' : ''}`;
  check(rows.length === 22, `${label}: expected 22 accessibility rows`);
  rows.forEach((row, i) => {
    const [bg, text] = [values[2 * i], values[2 * i + 1]];
    if (!row.text) return;
    check(close(text, { rgba: row.text === '#fff' ? [255, 255, 255, 255] : [0, 0, 0, 255] }), `${label}: ${row.background} text should be ${row.text}, got ${fmt(text)}`);
    const measured = contrastRatio(luminance(srgb(bg)), luminance(srgb(text)));
    check(Math.abs(measured - row.ratio) < 0.02, `${label}: ${row.background} rendered ratio ${measured.toFixed(3)} vs build-time ${row.ratio.toFixed(3)}`);
  });
  return rows.filter(r => r.text).length;
}

async function testAccessibility(chrome, safari) {
  const start = failures.length;
  const runs = [[chrome, 'index-native.html'], [chrome, 'index.html'], [chrome, 'index.html', { legacy: true }]];
  if (safari) runs.push([safari, 'index.html']);
  let measured = 0;
  for (const [browser, file, options] of runs) measured = await checkAccessibility(browser, file, options);
  console.log(`Accessibility table: ${measured} build-time WCAG ratios reproduced from rendered colours in ${runs.length} runs (native, compat, compat without contrast-color()${safari ? ', WebKit' : ''}) — ${failuresSince(start)}.`);
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
    const required = ['relativeOklch', 'mixOklch', 'lightDark'];
    const chromeFeatures = await features(chrome);
    console.log(`Chromium features: ${JSON.stringify(chromeFeatures)}`);
    if (safari) {
      const safariFeatures = await features(safari);
      console.log(`WebKit features: ${JSON.stringify(safariFeatures)}`);
      if (!required.every(f => safariFeatures[f]) || !safariFeatures.contrastColor) {
        console.warn('WebKit lacks a feature the compat build needs; skipping WebKit checks.');
        safari = null;
      }
    }
    if (!chromeFeatures.customFunctions || !chromeFeatures.contrastColor || !required.every(f => chromeFeatures[f])) {
      throw Error('This Chromium lacks CSS custom functions or contrast-color(), which the native comparisons need');
    }
    await testFixtures(chrome, safari);
    await testContrast(chrome, safari);
    await testDemos(chrome, safari);
    await testThemes(chrome, safari);
    await testAccessibility(chrome, safari);
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
