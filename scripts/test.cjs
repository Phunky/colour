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
assert.equal((native.match(/style\(--name:/g) || []).length, 21, '21 palette entries');
assert.equal((native.match(/@function --colour(?:-[\w-]+)?\(/g) || []).length, 11, 'all 11 CSS functions');
assert.equal((compatible.match(/#tone-[\w-]+ \+ \.tone-dot/g) || []).length, 21, 'all 21 swatches');
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
console.log('Checks passed: 21 colours, 11 functions, 11 accents, and both demo modes.');
