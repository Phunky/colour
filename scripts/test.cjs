#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = file => fs.readFileSync(path.resolve(__dirname, '../dist', file), 'utf8');
const native = output('colour.native.css');
const compatible = output('demo.compat.css');
const html = output('index.html');
const htmlNative = output('index-native.html');
const standalone = output('standalone-compatible.html');
const { transformFunction, replaceCalls } = require('./build.cjs');
assert.equal((native.match(/style\(--name:\s*[\w-]+\):\s*#/g) || []).length, 21, '21 palette entries');
assert.equal((native.match(/@function --colour(?:-[\w-]+)?\(/g) || []).length, 11, 'all 11 CSS functions');
assert.equal((compatible.match(/#tone-[\w-]+ \+ \.tone-dot/g) || []).length, 22, '21 palette swatches plus currentColor');
for (const name of ['lighten','darken','saturate','desaturate','adjust-hue','tint','shade','rgba','opacity','accent']) {
  assert(native.includes('@function --colour-'+name+'('), name);
}
for (const level of [50,100,200,300,400,500,600,700,800,900,1000]) {
  assert(compatible.includes('.accent-cell[data-level="'+level+'"]'), String(level));
}
assert(!/@function\s+--/.test(compatible), 'no @function rules in compatible CSS');
assert(!/--colour(?:-[\w-]+)?\(/.test(compatible), 'no uncompiled function calls');
assert(html.includes('demo.compat.css'), 'default loads compatible CSS');
assert(htmlNative.includes('colour.native.css'), 'native loads CSS functions');
assert(standalone.includes('<style>'), 'standalone embeds CSS');
assert(native.includes('style(--name: currentColor): currentColor'), 'native currentColor branch');
assert(html.includes('tone-currentColor'), 'demo includes currentColor swatch');
assert(compatible.includes('--colour-active: currentColor'), 'compat keeps currentColor keyword');
assert(compatible.includes('--colour-selected-swatch: currentColor'), 'compat currentColor swatch');
assert.equal(transformFunction('colour', 'currentColor'), 'currentColor', 'colour(currentColor)');
const currentColorCases = [
  ['colour-lighten', 'currentColor, 20', 'hsl(from currentColor h s clamp(0, calc(l + 20), 100) / alpha)'],
  ['colour-darken', 'currentColor, 20', 'hsl(from currentColor h s clamp(0, calc(l - 20), 100) / alpha)'],
  ['colour-saturate', 'currentColor, 30', 'hsl(from currentColor h clamp(0, calc(s + 30), 100) l / alpha)'],
  ['colour-desaturate', 'currentColor, 45', 'hsl(from currentColor h clamp(0, calc(s - 45), 100) l / alpha)'],
  ['colour-adjust-hue', 'currentColor, 90', 'hsl(from currentColor calc(h + 90) s l / alpha)'],
  ['colour-tint', 'currentColor, 42%', 'color-mix(in srgb, currentColor, white 42%)'],
  ['colour-shade', 'currentColor, 38%', 'color-mix(in srgb, currentColor, black 38%)'],
  ['colour-rgba', 'currentColor, 0.4', 'rgb(from currentColor r g b / 0.4)'],
  ['colour-opacity', 'currentColor, 0.6', 'rgb(from currentColor r g b / 0.6)'],
  ['colour-accent', 'currentColor, 700', 'hsl(from currentColor h s clamp(0, calc(l + -24), 100) / alpha)'],
];
for (const [name, args, expected] of currentColorCases) {
  assert.equal(transformFunction(name, args), expected, `${name}(currentColor)`);
}
assert(replaceCalls('background: --colour-lighten(currentColor, 12);').includes('from currentColor'),
  'replaceCalls preserves currentColor');
console.log('Checks passed: 21 colours, 11 functions, 11 accents, currentColor, and both demo modes.');
