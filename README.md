# colour

> **Define colours however you like. Manipulate them with CSS.**

A composable colour toolkit powered by native CSS functions. No JavaScript, and no built-in palette. This is a proof of concept.

**[Demo](https://phunky.github.io/colour/)** · [Native CSS demo](https://phunky.github.io/colour/index-native.html)

## Quick start

Copy [`src/colour.css`](./src/colour.css) into your project. No build step is required in browsers that support CSS custom functions (Chrome/Edge 139+).

```html
<link rel="stylesheet" href="colour.css">
```

## Using colours

Three interchangeable approaches. Mix them freely, including inside nested calls.

### Standard CSS colours

```css
background: --colour-darken(10, #6750a4);
background: --colour-lighten(20, red);
background: --colour-tone(65%, oklch(50% 0.2 250));
```

### CSS custom properties

```css
:root {
  --primary: #6750a4;
  --secondary: #03dac6;
}
.button {
  background: --colour-darken(10, var(--primary));
  border-color: --colour-tint(30%, var(--secondary));
}
```

### Optional named colours

Define your own `--colour()` after the library. Later definitions win:

```css
@function --colour(
  --value type(<custom-ident> | <color>): currentColor
) returns <color> {
  result: if(
    style(--value: primary): #6750a4;
    style(--value: secondary): #03dac6;
    style(--value: success): #22c55e;
    style(--value: danger): #ef4444;
    else: var(--value)
  );
}
.button {
  background: --colour-darken(10, primary);
}
.alert {
  background: --colour-tint(85%, danger);
}
```

CSS cannot turn `primary` into `var(--primary)` automatically. Named colours only exist if you define them in `--colour()`.

## Function reference

- **Amount first, colour last.**
- **The colour defaults to `currentColor`**, except in `--colour-mix()` and `--colour-contrast()`.
- **Any CSS colour works**, or a name resolved by your `--colour()`.

| Function | Does |
| --- | --- |
| `--colour(c)` | Resolves a colour (pass-through by default) |
| `--colour-lighten(n, c)` / `--colour-darken(n, c)` | HSL lightness ± n points |
| `--colour-saturate(n, c)` / `--colour-desaturate(n, c)` | HSL saturation ± n points |
| `--colour-adjust-hue(deg, c)` | Rotate hue (a number, no `deg`) |
| `--colour-tint(%, c)` / `--colour-shade(%, c)` | Mix with white / black |
| `--colour-tone(%, c)` | Set OKLCH lightness |
| `--colour-chroma(×, c)` | Multiply OKLCH chroma (0 = grey) |
| `--colour-mix(%, c1, c2)` | `color-mix(in oklch)`; `%` is `c2`'s share |
| `--colour-opacity(α, c)` / `--colour-rgba(α, c)` | Set alpha |
| `--colour-fade(×, c)` | Multiply alpha |
| `--colour-accent(level, c)` | Shade levels 50–1000 (500 = base) |
| `--colour-contrast(bg)` | Black or white text for `bg`, via `contrast-color()` |

## Composition

Every function returns a colour and accepts one. Ordinary CSS colours and custom properties need no extra setup:

```css
.button {
  --base: --colour-tone(
    65%,
    --colour-mix(35%, #2196f3, #9c27b0)
  );
  --background: var(--base);
  background: var(--background);
  color: --colour-contrast(var(--background));
  border-color: --colour-darken(15, var(--background));
  &:hover, &:focus-visible {
    --background: --colour-darken(10, var(--base));
  }
}
```

With a custom `--colour()` loaded (see [Optional palettes](#optional-palettes)), the same pattern can use names such as `--colour-mix(35%, primary, secondary)`.

Notes:

- **HSL vs OKLCH.** Lighten, darken, saturate and accent adjust HSL. Tone, chroma and mix are perceptual (OKLCH). Browsers clip out-of-gamut OKLCH.
- **Contrast** picks black or white only, ignores alpha, and only sees the colour you pass in.
- **Chromium rejects a function nested in itself**, such as `--colour-lighten(10, --colour-lighten(10, red))` ([w3c/csswg-drafts#13943](https://github.com/w3c/csswg-drafts/issues/13943)). Nesting different functions is fine.

## Optional palettes

Neither example is required. Load one after `colour.css` if you want named colours:

| File | Purpose |
| --- | --- |
| [`examples/named.css`](./examples/named.css) | Small semantic palette (`primary`, `success`, `danger`, …) |
| [`examples/material.css`](./examples/material.css) | Material Design colour names |

```html
<link rel="stylesheet" href="colour.css">
<link rel="stylesheet" href="examples/named.css">
```

Or write your own `--colour()`. Standard CSS named colours (`red`, `blue`, …) keep their standard values unless you override them.

## Browser support

Native CSS custom functions need Chrome or Edge 139+ (and `--colour-contrast()` needs `contrast-color()`). Shipping Safari and Firefox do not run the native `@function` API yet.

For those browsers, [`scripts/compiler.cjs`](./scripts/compiler.cjs) can compile `--colour*()` calls into relative-colour and `color-mix()` CSS at build time. Pass optional named colours explicitly:

```js
const fs = require('node:fs');
const { createCompiler } = require('./scripts/compiler.cjs');
const { compileValue } = createCompiler(
  fs.readFileSync('src/colour.css', 'utf8'),
  {
    paletteSource: fs.readFileSync(
      'examples/material.css',
      'utf8'
    )
  }
);
```

Without a `paletteSource`, CSS named colours (`red`, `blue`, …) keep their ordinary meaning; other bare identifiers fail the build. Palette values may be hex, `oklch()`, `var()`, `light-dark()`, and other CSS colours. The compiler is not a general `@function` polyfill.

```sh
npm install
npm run build   # writes dist/: compatible demo, native demo, CSS and standalone files
```

Pushing to `master` builds and deploys `dist/` via [`.github/workflows/pages.yml`](./.github/workflows/pages.yml).

## Migration

If you used an older build where Material names were baked into the core library: they are not anymore. Include [`examples/material.css`](./examples/material.css) after `colour.css`, or switch to hex / `var()` / your own names. `--colour(red)` is CSS `red` (`#ff0000`) unless you override it — not Material `#f44336`.

## History

An earlier Sass version lived here in 2015. See the [final Sass commit](https://github.com/Phunky/colour/tree/baf463e1caf8d6b90d1d58fc31eff56b12739d72) if you need it. See [LICENSE](LICENSE).
