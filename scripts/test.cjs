#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createCompiler } = require('./compiler.cjs');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const native = read('dist/colour.native.css');
const compatible = read('dist/demo.compat.css');
const html = read('dist/index.html');
const htmlNative = read('dist/index-native.html');
const standalone = read('dist/standalone-compatible.html');
const demoSource = read('src/demo.css');
const htmlSource = read('src/index.html');
const { compileValue, palette, accent } = createCompiler(read('src/colour.css'));

// Palette, functions and accents.
assert.equal((native.match(/style\(--value:\s*[\w-]+\):\s*#/g) || []).length, 21, '21 palette entries');
assert.equal(palette.size, 21, 'compiler reads 21 palette entries');
assert.equal(accent.size, 11, 'compiler reads 11 accent levels');
assert.equal((native.match(/@function --colour(?:-[\w-]+)?\(/g) || []).length, 11, 'all 11 CSS functions');
assert.match(native, /@function --colour\(--value type\(<custom-ident> \| <color>\): currentColor\)/, '--colour() defaults to currentColor');
const FUNCTIONS = {
  lighten: '10', darken: '15', saturate: '20', desaturate: '30', 'adjust-hue': '90',
  tint: '25%', shade: '30%', rgba: '0.5', opacity: '0.5', accent: '700',
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
  ['--colour-mix(red)', /Unsupported custom function --colour-mix/],
  ['--brand-colour(red)', /Unsupported custom function/],
  ['--colour-opacity(0.5, --colour-lighten(blue, 10))', /expected a number/],
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
const cards = [...htmlSource.matchAll(/data-example="([\w-]+)"[^]*?<pre class="code-box"><code>([^]*?)<\/code><\/pre>/g)];
assert(cards.length >= 12, 'composition examples present');
for (const [, example, code] of cards) {
  const rule = demoSource.match(new RegExp(`\\.compose-card\\[data-example="${example}"\\] \\.compose-swatch::before \\{ background: ([^;]+); \\}`));
  assert(rule, `CSS rule for composition example ${example}`);
  assert.equal(normalise(code), normalise(rule[1]), `displayed code matches CSS for ${example}`);
}
const operationCodes = [...htmlSource.matchAll(/data-fn="([\w-]+)"[^]*?<code class="code-box">([^<]+)<\/code>/g)];
assert.equal(operationCodes.length, 9, 'nine operation cards');
for (const [, fn, code] of operationCodes) assert(demoSource.includes(code), `operation card ${fn} shows its real CSS`);

console.log(`Checks passed: ${palette.size} colours, 11 functions, ${accent.size} accents, ${cards.length} compositions, compiler edge cases and both demo modes.`);
