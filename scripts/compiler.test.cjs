'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createCompiler } = require('./compiler.cjs');
const compiler = createCompiler(fs.readFileSync('src/colour.css', 'utf8'), {
  paletteSource: fs.readFileSync('examples/named.css', 'utf8'),
});
test('golden rotation matches hue adjustment, including wrap and alpha', () => {
  for (const step of [-4, -.5, 0, 1, 12]) {
    assert.deepEqual(compiler.staticColour(`--colour-golden(${step}, #80402080)`),
      compiler.staticColour(`--colour-adjust-hue(${137.507764 * step}, #80402080)`));
  }
});
test('saturation scales and clamps without changing alpha', () => {
  for (const [factor, saturation] of [[-1, 0], [0, 0], [.5, 20], [1, 40], [4, 100]]) {
    const actual = compiler.staticColour(`--colour-scale-saturation(${factor}, hsl(30 40% 50% / .3))`);
    const expected = compiler.staticColour(`hsl(30 ${saturation}% 50% / .3)`);
    for (const channel of ['r', 'g', 'b', 'alpha']) assert.ok(Math.abs(actual[channel] - expected[channel]) < 1e-10);
  }
});
test('defaults, dynamic inputs, names and nested functions compile', () => {
  assert.match(compiler.compileValue('--colour-golden(1)'), /from currentColor/);
  assert.match(compiler.compileValue('--colour-scale-saturation(var(--factor), red)'), /s \* var\(--factor\)/);
  const result = compiler.compileValue('--colour-tint(85%, --colour-scale-saturation(.5, --colour-golden(calc(1 + 1), var(--base))))');
  assert.ok(!result.includes('--colour-'));
  assert.match(result, /137\.507764 \* calc\(1 \+ 1\)/);
  assert.ok(compiler.staticColour('--colour-golden(1, primary)'));
  assert.ok(compiler.compileFallback('--colour-contrast(--colour-golden(1, #ff0000))'));
  for (const name of ['golden', 'scale-saturation']) {
    assert.throws(() => compiler.compileValue(`--colour-${name}()`));
    assert.throws(() => compiler.compileValue(`--colour-${name}(50%, red)`));
  }
});
