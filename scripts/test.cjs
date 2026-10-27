#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createCompiler, contrastReport, contrastRatio, luminance, toOklch } = require('./compiler.cjs');

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
for (const level of accent.keys()) assert(compatible.includes(`.accent-cell[data-level="${level}"]`), `accent ${level} in demo`);

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
const report = name => contrastReport(staticColour(`--colour(${name})`));
assert.deepEqual(report('white'), { text: '#000', ratio: 21, aa: true, aaa: true }, 'white');
assert.deepEqual(report('black'), { text: '#fff', ratio: 21, aa: true, aaa: true }, 'black');
for (const name of palette.keys()) {
  const r = report(name);
  assert(r.ratio > 1 && r.aa === (r.ratio >= 4.5) && r.aaa === (r.ratio >= 7), `${name} thresholds`);
  assert.equal(r.text, compileFallback(`--colour-contrast(${name})`), `${name} report agrees with the contrast fallback`);
  const other = contrastRatio(luminance(staticColour(`--colour(${name})`)), r.text === '#fff' ? 0 : 1);
  assert(r.ratio >= other, `${name}: chosen text has the higher ratio`);
}
assert.equal(report('blue-grey').aa, true);
assert.equal(report('blue-grey').aaa, false);
assert.match(contrastReport(staticColour('--colour-opacity(0.6, indigo)')).reason, /translucent/);
assert.match(contrastReport(null).reason, /runtime/);
const tie = Array.from({ length: 2551 }, (_, i) => `rgb(${i / 10}, ${i / 10}, ${i / 10})`).find(c => contrastReport(staticColour(c)).reason);
assert(tie, 'a grey close to the black/white crossover exists');
assert.match(contrastReport(staticColour(tie)).reason, /too close to call/);
assert.equal(compileFallback(`--colour-contrast(${tie})`), null, `no static guess for the near-tie ${tie}`);

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

// Generated demo files.
assert(!/@function\s+--/.test(compatible), 'no @function rules in compatible CSS');
assert(!/--[\w-]+\(/.test(compatible.replace(/\/\*[^]*?\*\//g, '')), 'no uncompiled function calls');
assert(compatible.includes('main:has(#tone-currentColor:checked) { --active: currentColor;'), 'currentColor stays dynamic');
assert(/rgb\(from hsl\(from hsl\(from currentColor/.test(compatible), 'nested currentColor composition preserved');
assert(html.includes('demo.compat.css') && !html.includes('colour.native.css'), 'default page loads compatible CSS');
assert(htmlNative.includes('colour.native.css'), 'native page loads CSS functions');
assert(!/style="[^"]*--colour/.test(html), 'compat inline styles compiled');
assert(htmlNative.includes('style="--token: --colour(red);"'), 'native inline styles untouched');
assert(standalone.includes('<style>'), 'standalone embeds CSS');
assert.equal((htmlSource.match(/<input id="tone-/g) || []).length, 22, '21 palette options plus currentColor');
for (const name of palette.keys()) assert(htmlSource.includes(`id="tone-${name}"`), `tone-${name} option`);
for (const name of palette.keys()) assert(demoSource.includes(`main:has(#tone-${name}:checked) { --active: --colour(${name}); }`), `tone-${name} rule`);

// The expression shown in each composition card is exactly the one the card renders.
const normalise = s => s.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
const cards = [...htmlSource.matchAll(/class="compose-card surface" data-example="([\w-]+)"[^]*?<pre class="code-box"><code>([^]*?)<\/code><\/pre>/g)];
assert(cards.length >= 12, 'composition examples present');
for (const [, example, code] of cards) {
  const rule = demoSource.match(new RegExp(`\\.compose-card\\[data-example="${example}"\\] \\.compose-swatch::before \\{ background: ([^;]+); \\}`));
  assert(rule, `CSS rule for composition example ${example}`);
  assert.equal(normalise(code), normalise(rule[1]), `displayed code matches CSS for ${example}`);
}
// Contrast: chips cover the whole palette, cards show their real expressions,
// and the compat output keeps contrast-color() behind @supports with fallbacks.
for (const name of palette.keys()) {
  assert(htmlSource.includes(`data-colour="${name}"><strong>${name}</strong><code>--colour-contrast(${name})</code>`), `contrast chip ${name}`);
  assert(demoSource.includes(`.contrast-chip[data-colour="${name}"] { background: --colour(${name}); --text-colour: --colour-contrast(${name}); }`), `contrast chip rule ${name}`);
  const fallback = compileFallback(`--colour-contrast(${name})`);
  assert(compatible.includes(`.contrast-chip[data-colour="${name}"] { background: ${palette.get(name)}; --text-colour: ${fallback}; }\n@supports (color: contrast-color(red)) {\n .contrast-chip[data-colour="${name}"] { --text-colour: contrast-color(${palette.get(name)}); } }`), `compat contrast chip ${name}`);
}
const contrastCards = [...htmlSource.matchAll(/data-example="([\w-]+)"><div class="contrast-sample">[^]*?<pre class="code-box"><code>background: ([^]*?);\ncolor: ([^]*?);<\/code><\/pre>/g)];
assert.equal(contrastCards.length, 9, 'nine contrast examples');
for (const [, example, background, color] of contrastCards) {
  const rule = demoSource.match(new RegExp(`\\.contrast-card\\[data-example="${example}"\\] \\.contrast-sample \\{ background: ([^;]+);(?: --text-colour: #(?:000|fff);)? --text-colour: ([^;]+); \\}`));
  assert(rule, `CSS rule for contrast example ${example}`);
  assert.equal(normalise(background), normalise(rule[1]), `background shown for ${example}`);
  assert.equal(normalise(color), normalise(rule[2]), `contrast shown for ${example}`);
  assert(rule[2].startsWith('--colour-contrast('), `${example} uses --colour-contrast()`);
}
const contrastDecls = (demoSource.match(/:\s*--colour-contrast\(/g) || []).length;
assert.equal(contrastDecls, 34, 'contrast declarations in the demo');
assert.equal((compatible.match(/@supports \(color: contrast-color\(red\)\)/g) || []).length, contrastDecls, 'every contrast rule is progressively enhanced');

// Alpha cards show their real expression, and the label states the expected alpha.
const alphaCards = [...htmlSource.matchAll(/class="alpha-card surface" data-example="([\w-]+)"><div class="alpha-swatch" data-alpha="([\d.]+)">[^]*?<pre class="code-box"><code>([^]*?)<\/code><\/pre>/g)];
assert.equal(alphaCards.length, 6, 'six alpha examples');
for (const [, example, alpha, code] of alphaCards) {
  const rule = demoSource.match(new RegExp(`\\.alpha-card\\[data-example="${example}"\\] \\.alpha-swatch::before \\{ background: ([^;]+); \\}`));
  assert(rule, `CSS rule for alpha example ${example}`);
  assert.equal(normalise(code), normalise(rule[1]), `displayed code matches CSS for ${example}`);
  const value = staticColour(rule[1].replaceAll('var(--active)', 'blue'));
  assert(near(value.alpha, Number(alpha), 1e-9), `${example}: label α ${alpha}, computed ${value.alpha}`);
}

// Theme switch: CSS-only, and the code panel shows declarations the preview really uses.
assert.equal((htmlSource.match(/<input id="scheme-(system|light|dark)" type="radio" name="scheme"/g) || []).length, 3, 'three scheme radios');
for (const [selector, scheme] of [['scheme-light', 'light'], ['scheme-dark', 'dark']]) {
  assert(compatible.includes(`main:has(#${selector}:checked) .theme-stage { color-scheme: ${scheme}; }`), `${scheme} switch`);
}
assert(compatible.includes('.theme-stage { color-scheme: light dark;'), 'system scheme by default');
assert(compatible.includes('.theme-badge { background: light-dark(#ffc107, #3f51b5); --text-colour: light-dark(#000, #fff); }'), 'static light-dark() contrast fallback');
const themeCode = htmlSource.match(/<pre class="code-window theme-code"><code>([^]*?)<\/code><\/pre>/)[1];
const themeDeclarations = [...themeCode.matchAll(/(--background|background|color|border-color): ([^;]+);/g)];
assert(themeDeclarations.length >= 8, 'theme code panel declarations');
const themeCss = normalise(demoSource.match(/\.theme-card \{ --background[^]*?\.theme-badge \{[^\n]*/)[0]);
for (const [, property, value] of themeDeclarations) {
  assert(themeCss.includes(normalise(value)), `theme preview uses ${property}: ${normalise(value)}`);
}

// Accessibility table: generated from the compiler, never hand-written.
const rows = [...html.matchAll(/<tr data-background="([^"]+)"([^>]*)>([^]*?)<\/tr>/g)];
assert.equal(rows.length, 22, '21 palette rows plus a translucent example');
assert(!/<tr data-background/.test(htmlSource), 'no hand-written accessibility rows in the source');
for (const [, background, data, cells] of rows) {
  if (!palette.has(background)) {
    assert.equal(data, '', `${background} has no ratio`);
    assert.match(cells, /Not computed \(translucent/, `${background} explains why`);
    continue;
  }
  const r = report(background);
  assert.equal(data, ` data-text="${r.text}" data-ratio="${r.ratio}"`, `${background} data`);
  const shown = cells.match(/<td>([\d.]+):1<\/td><td><span class="a11y-(pass|fail)">\w+<\/span><\/td><td><span class="a11y-(pass|fail)">/);
  assert(shown, `${background} cells`);
  assert.equal(shown[1], (Math.floor(r.ratio * 100) / 100).toFixed(2), `${background} ratio truncated, not rounded up`);
  assert.equal(shown[2] === 'pass', r.aa, `${background} AA`);
  assert.equal(shown[3] === 'pass', r.aaa, `${background} AAA`);
  assert(cells.includes(`color: ${r.text}; color: contrast-color(${palette.get(background)});`), `${background} sample uses contrast-color() with the computed fallback`);
}
assert(htmlNative.includes('<span class="a11y-sample" style="background: --colour(red); color: --colour-contrast(red);">'), 'native table uses the library');
assert(compatible.includes('.contrast-card[data-example="custom-property"] .contrast-sample { background: var(--brand); --text-colour: #000; }'), 'runtime backgrounds keep the author fallback');
assert(compatible.includes('--text-colour: contrast-color(var(--brand));'), 'runtime backgrounds use native contrast-color()');

const operationCodes = [...htmlSource.matchAll(/data-fn="([\w-]+)"[^]*?<code class="code-box">([^<]+)<\/code>/g)];
assert.equal(operationCodes.length, 9, 'nine operation cards');
for (const [, fn, code] of operationCodes) assert(demoSource.includes(code), `operation card ${fn} shows its real CSS`);

console.log(`Checks passed: ${palette.size} colours, 16 functions, ${accent.size} accents, ${cards.length} compositions, ${alphaCards.length} alpha examples, ${contrastDecls} contrast declarations, ${rows.length} accessibility rows, compiler edge cases, theme switch and both demo modes.`);
