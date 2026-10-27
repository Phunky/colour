#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createCompiler, contrastRatio, luminance, toOklch, parseHex } = require('./compiler.cjs');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const native = read('dist/colour.native.css');
const compatible = read('dist/demo.compat.css');
const html = read('dist/index.html');
const htmlNative = read('dist/index-native.html');
const standalone = read('dist/standalone-compatible.html');
const demoSource = read('src/demo.css');
const htmlSource = read('src/index.html');
const { compileValue, compileFallback, staticColour, palette, accent } = createCompiler(read('src/colour.css'));

// Palette, functions and accents.
assert.equal((native.match(/style\(--value:\s*[\w-]+\):\s*#/g) || []).length, 21, '21 palette entries');
assert.equal(palette.size, 21, 'compiler reads 21 palette entries');
assert.equal(accent.size, 11, 'compiler reads 11 accent levels');
assert.equal((native.match(/@function --colour(?:-[\w-]+)?\(/g) || []).length, 16, 'all 16 CSS functions');
assert.match(native, /@function --colour-mix\(--weight <percentage>, --first type\(<custom-ident> \| <color>\), --second type\(<custom-ident> \| <color>\)\) returns <color> \{\s*result: color-mix\(in oklch, --colour\(var\(--first\)\), --colour\(var\(--second\)\) var\(--weight\)\);/,
  '--colour-mix() needs both colours, resolves them through --colour() and mixes in OKLCH');
assert.match(native, /@function --colour-contrast\(--background type\(<custom-ident> \| <color>\)\) returns <color> \{\s*result: contrast-color\(--colour\(var\(--background\)\)\);/,
  '--colour-contrast() requires a background and delegates to --colour() and contrast-color()');
assert.match(native, /@function --colour\(--value type\(<custom-ident> \| <color>\): currentColor\)/, '--colour() defaults to currentColor');
const FUNCTIONS = {
  lighten: '10', darken: '15', saturate: '20', desaturate: '30', 'adjust-hue': '90',
  tint: '25%', shade: '30%', rgba: '0.5', opacity: '0.5', accent: '700',
  fade: '0.5', tone: '85%', chroma: '0.5',
};
for (const name of Object.keys(FUNCTIONS)) {
  assert.match(native, new RegExp(`@function --colour-${name}\\(--\\w+ <\\w+>, --value type\\(<custom-ident> \\| <color>\\): currentColor\\)`), `${name}: amount first, optional colour last`);
}

// Compiler: each function with omitted, explicit currentColor, palette and arbitrary colours.
const expected = (name, amount, base) => ({
  lighten: `hsl(from ${base} h s clamp(0, calc(l + ${amount}), 100) / alpha)`,
  darken: `hsl(from ${base} h s clamp(0, calc(l - ${amount}), 100) / alpha)`,
  saturate: `hsl(from ${base} h clamp(0, calc(s + ${amount}), 100) l / alpha)`,
  desaturate: `hsl(from ${base} h clamp(0, calc(s - ${amount}), 100) l / alpha)`,
  'adjust-hue': `hsl(from ${base} calc(h + ${amount}) s l / alpha)`,
  tint: `color-mix(in srgb, ${base}, white ${amount})`,
  shade: `color-mix(in srgb, ${base}, black ${amount})`,
  rgba: `rgb(from ${base} r g b / ${amount})`,
  opacity: `rgb(from ${base} r g b / ${amount})`,
  fade: `rgb(from ${base} r g b / clamp(0, calc(alpha * ${amount}), 1))`,
  tone: `oklch(from ${base} ${amount} c h / alpha)`,
  chroma: `oklch(from ${base} l max(0, c * ${amount}) h / alpha)`,
  accent: `hsl(from ${base} h s clamp(0, calc(l + ${accent.get(amount)}), 100) / alpha)`,
}[name]);
const colours = [
  [null, 'currentColor'],
  ['currentColor', 'currentColor'],
  ['blue', palette.get('blue')],
  ['red', palette.get('red')],
  ['#6750a4', '#6750a4'],
  ['rgb(255, 87, 34)', 'rgb(255, 87, 34)'],
  ['hsl(120 50% 50%)', 'hsl(120 50% 50%)'],
  ['oklch(60% 0.2 250)', 'oklch(60% 0.2 250)'],
  ['rebeccapurple', 'rebeccapurple'],
  ['var(--brand)', 'var(--brand)'],
  ['var(--brand, rgb(1, 2, 3))', 'var(--brand, rgb(1, 2, 3))'],
  ['var(--brand, --colour(teal))', `var(--brand, ${palette.get('teal')})`],
];
for (const [name, amount] of Object.entries(FUNCTIONS)) {
  for (const [input, base] of colours) {
    const call = input === null ? `--colour-${name}(${amount})` : `--colour-${name}(${amount}, ${input})`;
    assert.equal(compileValue(call), expected(name, amount, base), call);
  }
}
for (const [name, hex] of palette) assert.equal(compileValue(`--colour(${name})`), hex, `--colour(${name})`);
for (const [input, base] of colours) assert.equal(compileValue(input === null ? '--colour()' : `--colour(${input})`), base, `--colour(${input ?? ''})`);
for (const level of accent.keys()) {
  assert.equal(compileValue(`--colour-accent(${level}, red)`), expected('accent', level, palette.get('red')), `accent ${level}`);
}

// Composition: inner calls compile first, at any depth, including repeated functions and nested commas.
const lighten15Blue = expected('lighten', '15', palette.get('blue'));
assert.equal(compileValue('--colour-opacity(0.8, --colour-lighten(15, blue))'), expected('opacity', '0.8', lighten15Blue));
assert.equal(
  compileValue('--colour-opacity(0.8, --colour-saturate(20, --colour-darken(10, blue)))'),
  expected('opacity', '0.8', expected('saturate', '20', expected('darken', '10', palette.get('blue')))));
assert.equal(compileValue('--colour-opacity(0.5, --colour-lighten(20))'), expected('opacity', '0.5', expected('lighten', '20', 'currentColor')));
assert.equal(
  compileValue('--colour-lighten(10, --colour-lighten(10, --colour-lighten(10, --colour(red))))'),
  expected('lighten', '10', expected('lighten', '10', expected('lighten', '10', palette.get('red')))));
assert.equal(
  compileValue('--colour-tint(10%, color-mix(in srgb, --colour(red), --colour-shade(20%, amber) 40%))'),
  expected('tint', '10%', `color-mix(in srgb, ${palette.get('red')}, ${expected('shade', '20%', palette.get('amber'))} 40%)`));
let deep = 'red';
let deepExpected = palette.get('red');
for (let i = 0; i < 40; i++) { deep = `--colour-adjust-hue(1, ${deep})`; deepExpected = expected('adjust-hue', '1', deepExpected); }
assert.equal(compileValue(deep), deepExpected, '40 levels of nesting');
assert.equal(
  compileValue('linear-gradient(90deg, --colour-lighten(20, var(--active)), --colour(var(--active)) 50%, transparent)'),
  `linear-gradient(90deg, ${expected('lighten', '20', 'var(--active)')}, var(--active) 50%, transparent)`, 'calls inside other values');
assert.equal(compileValue('--colour-lighten(calc(5 * 2), blue)'), expected('lighten', 'calc(5 * 2)', palette.get('blue')), 'calc() amounts');
assert.equal(compileValue('1px solid #fff'), '1px solid #fff', 'non-library values are untouched');
assert.equal(compileValue('attr(data-mark)'), 'attr(data-mark)');

// --colour-contrast(): native contrast-color() output plus a static WCAG fallback when the background is known.
assert.equal(compileValue('--colour-contrast(blue)'), `contrast-color(${palette.get('blue')})`);
assert.equal(compileValue('--colour-contrast(var(--background))'), 'contrast-color(var(--background))');
assert.equal(compileValue('--colour-contrast(--colour-darken(15, blue))'), `contrast-color(${expected('darken', '15', palette.get('blue'))})`);
assert.equal(
  compileValue('--colour-contrast(--colour-opacity(0.8, --colour-lighten(20, red)))'),
  `contrast-color(${expected('opacity', '0.8', expected('lighten', '20', palette.get('red')))})`);
const staticContrast = {
  white: '#000', yellow: '#000', amber: '#000', lime: '#000', 'light-blue': '#000', cyan: '#000',
  black: '#fff', indigo: '#fff', 'deep-purple': '#fff', purple: '#fff', brown: '#fff',
};
for (const [name, choice] of Object.entries(staticContrast)) assert.equal(compileFallback(`--colour-contrast(${name})`), choice, `fallback for ${name}`);
assert.equal(compileFallback('--colour-contrast(#767676)'), '#000', 'WCAG crossover: #767676 favours black');
assert.equal(compileFallback('--colour-contrast(#757575)'), '#fff', 'WCAG crossover: #757575 favours white');
assert.equal(compileFallback('--colour-contrast(rgb(250, 250, 250))'), '#000', 'literal rgb()');
assert.equal(compileFallback('--colour-contrast(hsl(240 100% 20%))'), '#fff', 'literal hsl()');
assert.equal(compileFallback('--colour-contrast(--colour-lighten(40, --colour-darken(10, indigo)))'), '#000', 'nested static transformations');
assert.equal(compileFallback('--colour-contrast(--colour-shade(70%, yellow))'), '#fff', 'shaded light colour');
assert.equal(compileFallback('1px solid --colour-contrast(black)'), '1px solid #fff', 'contrast inside a shorthand');
for (const dynamic of ['var(--background)', 'currentColor', 'oklch(85% 0.1 200)', '--colour-lighten(10)', '--colour-lighten(var(--x), blue)', 'color-mix(in srgb, red, blue)']) {
  assert.equal(compileFallback(`--colour-contrast(${dynamic})`), null, `no static guess for ${dynamic}`);
}
assert.equal(compileFallback('--colour-lighten(10, blue)'), compileValue('--colour-lighten(10, blue)'), 'fallback is identical without contrast');
assert.equal(compileFallback('--colour-contrast(light-dark(--colour(amber), --colour(indigo)))'), 'light-dark(#000, #fff)', 'light-dark() of static colours');
assert.equal(compileFallback('--colour-contrast(light-dark(#fff, var(--x)))'), null, 'light-dark() with a runtime branch');
assert.equal(compileFallback('--colour-contrast(light-dark(white, black))'), null, 'CSS named colours inside light-dark() are not palette names');

// --colour-mix(): weight is the second colour's share, both colours required, any colour or composition.
const mixPairs = [
  ['red', 'blue', palette.get('red'), palette.get('blue')],
  ['#ff0000', 'currentColor', '#ff0000', 'currentColor'],
  ['var(--brand)', 'oklch(60% 0.2 250)', 'var(--brand)', 'oklch(60% 0.2 250)'],
  ['rgb(255 0 0 / 50%)', 'transparent', 'rgb(255 0 0 / 50%)', 'transparent'],
  ['--colour-lighten(10, purple)', '--colour-darken(10, blue)', expected('lighten', '10', palette.get('purple')), expected('darken', '10', palette.get('blue'))],
  ['color-mix(in srgb, red, blue)', 'var(--x, --colour(teal))', 'color-mix(in srgb, red, blue)', `var(--x, ${palette.get('teal')})`],
];
for (const [a, b, ca, cb] of mixPairs) {
  assert.equal(compileValue(`--colour-mix(30%, ${a}, ${b})`), `color-mix(in oklch, ${ca}, ${cb} 30%)`, `mix ${a} ${b}`);
}
assert.equal(compileValue('--colour-mix(var(--w), red, blue)'), `color-mix(in oklch, ${palette.get('red')}, ${palette.get('blue')} var(--w))`, 'runtime weight');
assert.equal(
  compileValue('--colour-tone(70%, --colour-chroma(0.8, --colour-mix(40%, purple, blue)))'),
  expected('tone', '70%', expected('chroma', '0.8', `color-mix(in oklch, ${palette.get('purple')}, ${palette.get('blue')} 40%)`)));
assert.equal(
  compileValue('--colour-darken(15, var(--background))'), expected('darken', '15', 'var(--background)'));
assert.equal(
  compileValue('light-dark(--colour(white), --colour-tone(20%, blue-grey))'),
  `light-dark(#fff, ${expected('tone', '20%', palette.get('blue-grey'))})`, 'library calls inside light-dark()');

// Static OKLCH evaluation (used for contrast fallbacks), checked against known values.
const near = (a, b, tolerance = 1e-3) => Math.abs(a - b) <= tolerance;
const blue = staticColour('--colour(blue)');
const blueLch = toOklch(blue);
assert(near(blueLch.l, 0.65816) && near(blueLch.c, 0.16896) && near(blueLch.h, 248.81, 0.05), 'blue in OKLCH matches the browser');
const faded = staticColour('--colour-fade(0.5, --colour-opacity(0.6, blue))');
assert(near(faded.alpha, 0.3, 1e-9) && near(faded.r, blue.r, 1e-9), 'fade multiplies alpha (0.6 × 0.5 = 0.3) and keeps the colour');
assert.equal(staticColour('--colour-fade(3, --colour-opacity(0.6, blue))').alpha, 1, 'fade clamps alpha to 1');
assert.equal(staticColour('--colour-fade(0, blue)').alpha, 0, 'fade to 0');
assert.equal(staticColour('--colour-opacity(0.5, --colour-fade(0.2, blue))').alpha, 0.5, 'opacity replaces faded alpha');
const grey = staticColour('--colour-chroma(0, blue)');
assert(near(grey.r, grey.g, 1e-6) && near(grey.g, grey.b, 1e-6) && near(toOklch(grey).l, blueLch.l, 1e-6), 'chroma 0 is a grey of the same lightness');
const chroma1 = staticColour('--colour-chroma(1, red)');
const red = staticColour('--colour(red)');
assert(['r', 'g', 'b'].every(k => near(chroma1[k], red[k], 1e-6)), 'chroma 1 preserves the colour');
const halfChroma = toOklch(staticColour('--colour-chroma(0.5, red)'));
assert(near(halfChroma.c, toOklch(red).c / 2, 1e-6) && near(halfChroma.l, toOklch(red).l, 1e-6) && near(halfChroma.h, toOklch(red).h, 1e-3), 'chroma 0.5 halves chroma, keeps L and h');
assert.equal(staticColour('--colour-chroma(1.2, blue)'), null, 'chroma beyond the sRGB gamut is not statically guessed');
const toned = toOklch(staticColour('--colour-tone(30%, blue-grey)'));
assert(near(toned.l, 0.3, 1e-6) && near(toned.c, toOklch(staticColour('--colour(blue-grey)')).c, 1e-6), 'tone sets absolute L, keeps chroma');
assert(near(toOklch(staticColour('--colour-tone(60%, --colour-opacity(0.4, grey))')).l, 0.6, 1e-6) && staticColour('--colour-tone(60%, --colour-opacity(0.4, grey))').alpha === 0.4, 'tone keeps alpha');
assert.equal(staticColour('--colour-tone(85%, blue)'), null, 'tone outside the sRGB gamut is not statically guessed');
assert.equal(staticColour('--colour-tone(50%)'), null, 'currentColor is runtime');
for (const [a, b] of [['red', 'blue'], ['white', 'teal'], ['--colour-opacity(0.5, red)', 'blue']]) {
  const start = staticColour(`--colour-mix(0%, ${a}, ${b})`);
  const end = staticColour(`--colour-mix(100%, ${a}, ${b})`);
  const [ca, cb] = [a, b].map(c => staticColour(c.startsWith('--') ? c : `--colour(${c})`));
  assert(['r', 'g', 'b', 'alpha'].every(k => near(start[k], ca[k], 1e-6) && near(end[k], cb[k], 1e-6)), `mix endpoints ${a}/${b}`);
}
const whiteBlue = toOklch(staticColour('--colour-mix(50%, white, blue)'));
assert(near(whiteBlue.h, blueLch.h, 1e-3) && near(whiteBlue.l, (1 + blueLch.l) / 2, 1e-3), 'achromatic white has a missing hue, so the mix keeps blue\'s hue');
const redBlue = toOklch(staticColour('--colour-mix(30%, red, blue)'));
assert(near(redBlue.l, 0.647303, 2e-4) && near(redBlue.c, 0.201418, 2e-4) && near(redBlue.h, 346.81, 0.05), 'mix(30%, red, blue) matches the browser (shorter hue arc)');
assert(near(staticColour('--colour-mix(50%, --colour-opacity(0.5, red), blue)').alpha, 0.75, 1e-9), 'mix interpolates alpha');
assert.equal(staticColour('--colour-mix(50%, red, var(--x))'), null, 'runtime colour in a mix');

// WCAG 2.x: luminance, ratios, thresholds and what cannot be computed.
assert(near(contrastRatio(luminance({ r: 1, g: 1, b: 1 }), luminance({ r: 0, g: 0, b: 0 })), 21, 1e-9), 'white on black is 21:1');
assert(near(contrastRatio(luminance(staticColour('#767676')), 1), 4.54, 0.01), '#767676 on white is 4.54:1');
for (const name of palette.keys()) {
  const background = luminance(staticColour(`--colour(${name})`));
  const choice = compileFallback(`--colour-contrast(${name})`);
  const [chosen, other] = choice === '#fff' ? [1, 0] : [0, 1];
  assert(contrastRatio(background, chosen) >= contrastRatio(background, other), `${name}: ${choice} has the higher WCAG ratio`);
}
const crossover = Array.from({ length: 2551 }, (_, i) => `rgb(${i / 10}, ${i / 10}, ${i / 10})`);
const tie = crossover.find(c => compileFallback(`--colour-contrast(${c})`) === null);
assert(tie, 'a grey close to the black/white crossover has no static guess');
const tieLuminance = luminance(staticColour(tie));
const [toWhite, toBlack] = [contrastRatio(tieLuminance, 1), contrastRatio(tieLuminance, 0)];
assert(Math.abs(toWhite - toBlack) / Math.max(toWhite, toBlack) < 0.005, `${tie} is a near-tie`);

// Malformed or unsupported calls fail loudly.
const failures = [
  ['--colour-lighten(10, blue', /Unclosed/],
  ['--colour-lighten(10, blue))', /Unexpected "\)"/],
  ['--colour-lighten()', /missing amount|expected 1 or 2/],
  ['--colour-lighten(10, blue, red)', /expected 1 or 2 arguments/],
  ['--colour-lighten(10, )', /empty colour argument/],
  ['--colour-lighten(blue, 10)', /expected a number/],
  ['--colour-tint(25, blue)', /expected a percentage/],
  ['--colour-opacity(50%, blue)', /expected a number/],
  ['--colour-accent(750, blue)', /accent level must be one of/],
  ['--colour-accent(var(--level), blue)', /accent level must be one of/],
  ['--colour(red, blue)', /at most 1 argument/],
  ['--colour(red blue)', /not a single CSS colour value/],
  ['--colour-mix(red)', /expected a weight and 2 colours/],
  ['--colour-mix(30%, red)', /expected a weight and 2 colours/],
  ['--colour-mix(30%, , blue)', /expected a weight and 2 colours/],
  ['--colour-mix(30%, red, blue, green)', /expected a weight and 2 colours/],
  ['--colour-mix(red, blue, 30%)', /expected a percentage/],
  ['--colour-mix(0.3, red, blue)', /expected a percentage/],
  ['--colour-mix(130%, red, blue)', /out of range \(0% to 100%\)/],
  ['--colour-mix(-10%, red, blue)', /out of range/],
  ['--colour-tone(150%, blue)', /out of range \(0% to 100%\)/],
  ['--colour-tone(0.5, blue)', /expected a percentage/],
  ['--colour-tone()', /missing amount|expected 1 or 2/],
  ['--colour-chroma(-1, blue)', /out of range \(at least 0\)/],
  ['--colour-chroma(50%, blue)', /expected a number/],
  ['--colour-fade(-0.5, blue)', /out of range \(at least 0\)/],
  ['--colour-fade(50%)', /expected a number/],
  ['--colour-fade(0.5, red blue)', /not a single CSS colour value/],
  ['--colour-tone(50%, --colour-mix(30%, red))', /expected a weight and 2 colours/],
  ['--colour-shift(10, red)', /Unsupported custom function --colour-shift/],
  ['--brand-colour(red)', /Unsupported custom function/],
  ['--colour-opacity(0.5, --colour-lighten(blue, 10))', /expected a number/],
  ['--colour-contrast()', /exactly 1 background colour/],
  ['--colour-contrast(blue, red)', /exactly 1 background colour/],
  ['--colour-contrast(red blue)', /not a single CSS colour value/],
];
for (const [value, pattern] of failures) assert.throws(() => compileValue(value), pattern, value);

// CSS hex colours must have exactly 3, 4, 6 or 8 digits.
for (const invalid of ['#12345', '#1234567']) {
  assert.equal(parseHex(invalid), null, `${invalid} is not a static colour`);
  assert.throws(() => compileValue(`--colour(${invalid})`), /invalid hex colour/);
}
for (const valid of ['#123', '#1234', '#123456', '#12345678']) {
  assert(parseHex(valid), `${valid} parses`);
  assert.equal(compileValue(`--colour(${valid})`), valid);
}

// Generated demo files.
assert(!/@function\s+--/.test(compatible), 'no @function rules in compatible CSS');
assert(!/--[\w-]+\(/.test(compatible.replace(/\/\*[^]*?\*\//g, '')), 'no uncompiled function calls');
assert(html.includes('demo.compat.css') && !html.includes('colour.native.css'), 'default page loads compatible CSS');
assert(htmlNative.includes('colour.native.css') && htmlNative.includes('demo.native.css'), 'native page loads CSS functions');
assert(standalone.includes('<style>') && !standalone.includes('<link rel="stylesheet"'), 'standalone embeds CSS');
assert(!/style="[^"]*--colour/.test(html), 'compat inline styles compiled');
assert(htmlNative.includes(`style="--swatch: --colour(red);"`), 'native inline styles untouched');
assert(htmlNative.includes('class="support-warning"') && !html.includes('support-warning'), 'only the native build warns about support');
assert(html.includes('href="index-native.html">Native CSS build') && htmlNative.includes('href="index.html">Compatible build'), 'each build links to the other');

// Every class and id used by a selector exists in the page, and every in-page link has a target.
const selectors = demoSource.replace(/\/\*[^]*?\*\//g, '').replace(/\{[^{}]*\}/g, ' ').replace(/@[^{]*\{/g, ' ');
for (const [, kind, name] of selectors.matchAll(/([.#])([a-zA-Z][\w-]*)/g)) {
  const pattern = kind === '#' ? new RegExp(`id="${name}"`) : new RegExp(`class="(?:[^"]* )?${name}(?: [^"]*)?"`);
  assert(pattern.test(htmlSource), `selector ${kind}${name} matches the page`);
}
for (const [, id] of htmlSource.matchAll(/href="#([\w-]+)"/g)) assert(htmlSource.includes(`id="${id}"`), `#${id} link target`);
for (const removed of ['accessibility', 'themes', 'accent-cell', 'alpha-card', 'compose-card', 'contrast-chip', 'build:']) {
  assert(!htmlSource.includes(removed) && !demoSource.includes(removed), `no remnants of ${removed}`);
}

// Palette: 21 radios driving --active, its contrast colour and its name; blue by default.
const normalise = s => s.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
assert.equal((htmlSource.match(/<input id="tone-/g) || []).length, 21, 'one option per palette colour');
assert(htmlSource.includes('<input id="tone-blue" type="radio" name="palette" value="blue" checked>'), 'blue is selected by default');
assert(demoSource.includes('main { --active: --colour(blue); --on-active: --colour-contrast(blue); --name: "blue"; }'), 'default state matches the default radio');
for (const name of palette.keys()) {
  assert(htmlSource.includes(`style="--swatch: --colour(${name});" title="${name}"><input id="tone-${name}" type="radio" name="palette" value="${name}"`), `${name} option`);
  if (name === 'blue') continue;
  assert(demoSource.includes(`main:has(#tone-${name}:checked) { --active: --colour(${name}); --on-active: --colour-contrast(${name}); --name: "${name}"; }`), `${name} rule`);
  const hex = palette.get(name);
  assert(compatible.includes(`main:has(#tone-${name}:checked) { --active: ${hex}; --on-active: ${compileFallback(`--colour-contrast(${name})`)}; --name: "${name}"; }\n@supports (color: contrast-color(red)) {\n main:has(#tone-${name}:checked) { --on-active: contrast-color(${hex}); } }`), `compat ${name} rule`);
}
assert(demoSource.includes('.preview { background: var(--active); color: var(--on-active);'), 'preview renders the code it shows');
assert(htmlSource.includes('<code>background: --colour(<span class="active-name"></span>);\ncolor: --colour-contrast(<span class="active-name"></span>);'), 'preview code');

// Each tile's caption, with the selected name substituted, is the declaration that paints it.
const tiles = [...htmlSource.matchAll(/<figure class="tile" data-fn="([\w-]+)"><i><\/i><figcaption><code>([^<]*)<span class="active-name"><\/span>\)<\/code>/g)];
assert.equal(tiles.length, 6, 'three groups of two tiles');
for (const [, fn, prefix] of tiles) {
  const rule = demoSource.match(new RegExp(`\\.tile\\[data-fn="${fn}"\\] i \\{ background: ([^;]+); \\}`));
  assert(rule, `CSS rule for tile ${fn}`);
  assert.equal(rule[1], `${prefix}var(--active))`, `tile ${fn} shows its real CSS`);
}

// Displayed code blocks match the declarations that render the hero alert, tags and composition.
const codeBlock = start => htmlSource.match(new RegExp(`<code>${start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^]*?)<\\/code>`))[1].replaceAll('&amp;', '&');
const declarations = code => [...normalise(code).matchAll(/([\w-]+): ([^;]+);/g)].map(([, p, v]) => `${p}: ${v};`);
const ruleFor = selector => normalise(demoSource.split('\n').filter(l => l.startsWith(`${selector} {`) && l.includes('--')).join(' '));
const [cardCode, buttonCode] = htmlSource.match(/<pre class="code compose-code"><code>([^]*?)<\/code>/)[1].replaceAll('&amp;', '&').split(/\n\n/);
const shownCode = { '.alert': codeBlock('.alert {'), '.tag': codeBlock('.tag {'), '.card': cardCode, '.button': buttonCode };
for (const selector of ['.alert', '.tag', '.card', '.button']) {
  const shown = declarations(shownCode[selector]);
  assert(shown.length > 0, `${selector}: example has CSS declarations`);
  for (const declaration of shown) assert(ruleFor(selector).includes(declaration), `${selector} uses ${declaration}`);
}
assert(ruleFor('.button').includes('&:hover, &:focus-visible { --background: --colour-darken(10, var(--base)); }'), 'hover/focus updates the effective background used for text contrast');
assert(demoSource.includes('@supports not (color: contrast-color(red)) { .button:is(:hover, :focus-visible) { color: #fff; } }'), 'older engines use a readable hover fallback');
assert(compatible.includes('.tag { background: color-mix(in srgb, currentColor, white 85%); border-color: color-mix(in srgb, currentColor, white 60%); }'), 'tags stay currentColor-based');
assert(compatible.includes('.card { --surface: light-dark(#fff, oklch(from #607d8b 25% c h / alpha)); background: var(--surface); color: light-dark(#000, #fff); }'), 'card keeps its author fallback');
for (const scheme of ['light', 'dark']) assert(compatible.includes(`main:has(#scheme-${scheme}:checked) .stage { color-scheme: ${scheme}; }`), `${scheme} switch`);

const contrastDecls = (demoSource.match(/:\s*--colour-contrast\(/g) || []).length;
assert.equal(contrastDecls, 23, 'contrast declarations in the demo');
assert.equal((compatible.match(/@supports \(color: contrast-color\(red\)\)/g) || []).length, contrastDecls, 'every contrast rule is progressively enhanced');

console.log(`Checks passed: ${palette.size} colours, 16 functions, ${accent.size} accents, compiler edge cases, ${tiles.length} playground tiles, displayed code and both demo modes.`);
