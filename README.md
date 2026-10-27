# colour

> **11 years later, we can finally do this without Sass!**

In 2015, `colour` was a Sass library for named colours. It is now a set of native CSS functions: no Sass, no JavaScript. This is a proof of concept.

**[Demo](https://phunky.github.io/colour/)** · [Native CSS demo](https://phunky.github.io/colour/index-native.html)

```css
.button {
  --base: --colour-tone(65%, --colour-mix(35%, blue, purple));
  --background: var(--base);
  background: var(--background);
  color: --colour-contrast(var(--background));
  border-color: --colour-darken(15, var(--background));
  &:hover, &:focus-visible {
    --background: --colour-darken(10, var(--base));
  }
}
```

## Usage

Copy [`src/colour.css`](./src/colour.css) into your project:

```html
<link rel="stylesheet" href="colour.css">
```

It needs CSS custom functions (`@function`), currently Chrome/Edge 139+. For other browsers, see [Compatible build](#compatible-build).

## API

- **Amount first, colour last.**
- **The colour defaults to `currentColor`**, except in `--colour-mix()` and `--colour-contrast()`.
- **Any CSS colour works:** a palette name, hex, `rgb()`, `oklch()`, `var()`, `light-dark()`, or another function's result.

| Function | Does |
| --- | --- |
| `--colour(c)` | Palette lookup; other colours pass through |
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

Palette: `red`, `pink`, `purple`, `deep-purple`, `indigo`, `blue`, `light-blue`, `cyan`, `teal`, `green`, `light-green`, `lime`, `yellow`, `amber`, `orange`, `deep-orange`, `brown`, `grey`, `blue-grey`, `black`, `white`. These names override CSS named colours: `--colour(red)` is `#f44336`.

```css
.tag {
  color: --colour(purple);
  background: --colour-tint(85%);   /* currentColor */
  border-color: --colour-tint(60%);
}

.card {
  --surface: light-dark(--colour(white), --colour-tone(25%, blue-grey));
  background: var(--surface);
  color: --colour-contrast(var(--surface));
}
```

Notes:

- **HSL vs OKLCH.** The lighten, darken, saturate and accent functions keep the Sass behaviour (HSL). `tone`, `chroma` and `mix` are perceptual (OKLCH). Browsers clip out-of-gamut OKLCH, so `--colour-tone(100%, blue)` isn't white; lower the chroma too.
- **Contrast** picks black or white only, ignores alpha, and only sees the colour you pass in.
- **Chromium rejects a function nested in itself**, such as `--colour-lighten(10, --colour-lighten(10, red))` ([w3c/csswg-drafts#13943](https://github.com/w3c/csswg-drafts/issues/13943)). Nesting different functions is fine.

### Migrating from the earlier CSS API

The arguments were swapped: `--colour-lighten(blue, 10)` is now `--colour-lighten(10, blue)`. Drop the colour to use `currentColor`. The Sass API in `_colour.scss` is unchanged.

## Compatible build

[`scripts/compiler.cjs`](./scripts/compiler.cjs) compiles the function calls in the demo's CSS into plain relative-colour and `color-mix()` CSS at build time. This is for Safari 18+, Firefox 133+ and Chromium 131+. It isn't a general `@function` polyfill:

- Palette names must appear literally.
- `--colour-contrast()` compiles to `contrast-color()` inside `@supports`, with a static black/white fallback when the background is known at build time. Otherwise, declare your own fallback first.

```sh
npm install
npm run build   # writes dist/: index.html (compatible), index-native.html, CSS and standalone files
```

Pushing to `master` builds and deploys `dist/` to GitHub Pages via [`.github/workflows/pages.yml`](./.github/workflows/pages.yml).

## The original

*"An opinionated way to manage and use colours within your SASS workflow."* `_colour.scss` is still here, unchanged. See [LICENSE](LICENSE).
