# colour

> **11 years later, we can finally do this without Sass!**

In 2015, `colour` was an opinionated way to use named colours inside Sass. Now native CSS functions, relative colour syntax and `color-mix()` can bring the same idea to the browser, **without Sass or browser-side JavaScript**.

**[Try the interactive demo](https://phunky.github.io/colour/)** · [Native CSS version](https://phunky.github.io/colour/index-native.html)

## From Sass to CSS

The original `_colour.scss` is still available for existing projects. The new [`src/colour.css`](./src/colour.css) defines the entire 21-colour palette **once**, inside `--colour()`. The other functions delegate to that single source of truth. No generated global colour variables are needed.

```css
.button {
  background: --colour(blue);
  color: --colour(white);
}
.button:hover {
  background: --colour-darken(blue, 10);
}
.alert {
  background: --colour-tint(red, 85%);
  border-color: --colour-accent(red, 700);
}
.overlay {
  background: --colour-opacity(black, 0.5);
}
```

## Features

- 21 Material-inspired named colours, defined in one native CSS function.
- 11 functions: colour lookup, lighten, darken, saturate, desaturate, adjust hue, tint, shade, RGBA, opacity, and accents.
- 11 accent levels: 50–1000 (500 is the original base colour).
- Fully interactive responsive demo: choosing a colour changes every swatch, transformation, accent and component with CSS `:has()` — **no browser JavaScript**.
- Native `@function` version and a build-time compiled demo for iOS Safari, Firefox and other browsers without support for CSS custom functions.

## Browser support and compatibility

The library's **native CSS** is experimental: `@function` and `if(style(...))` are not universally available. For browsers without custom functions, the **default demo** is compiled at build time into CSS using relative HSL colours, `color-mix()` and `:has()`. Both demos use only CSS at runtime.

The compatibility transform in [`scripts/build.cjs`](./scripts/build.cjs) is **specific to this demo and its existing function calls**. It is not a general-purpose polyfill that makes `--colour(blue)` usable in arbitrary Safari stylesheets. For general use, import [`src/colour.css`](./src/colour.css) in a browser with native custom-function support. The `dist/demo.compat.css` output can be used with the included demo HTML.

The built demo targets modern browsers with relative colour syntax and `:has()` (including recent iOS Safari). These features also need browser support; this is not a legacy-browser polyfill.

## Build and test

Requires Node.js 20+:

```sh
npm install
npm test
```

The build writes the following files into `dist/`:

| File | Purpose |
| --- | --- |
| `index.html` | GitHub Pages landing page, using Safari-compatible CSS |
| `index-native.html` | Demo using the native CSS library directly |
| `colour.native.css` | Native CSS custom functions from `src/colour.css` |
| `demo.native.css` | Demo styles calling those functions |
| `demo.compat.css` | Generated compatible demo CSS |
| `standalone-compatible.html` | Single-file version of the compatibility demo |
| `standalone-native.html` | Single-file version of the native demo |

The original `_colour.scss` remains unchanged, preserving the existing Sass API. To compare the rendered demos, switch between the native and compatibility links in the banner at the top of the demo.

## GitHub Pages

Pushing to `master` runs the workflow in [`.github/workflows/pages.yml`](./.github/workflows/pages.yml), tests and builds the demo, and uploads the `dist/` directory for deployment. For the first deployment, configure **Settings → Pages → Build and deployment → Source → GitHub Actions**.

Intended public URL: **https://phunky.github.io/colour/** (after enabling and deploying Pages).

## Colour maths

Lighten/darken and saturate/desaturate adjust HSL values by percentage points. Tint and shade use sRGB colour mixing. Accent offsets follow the original Sass project's design and are not exact Material Design swatches. The new CSS relies on modern colour processing, so some converted results can differ slightly from historical Sass output.

## The original

The original README said: *“An opinionated way to manage and use colours within your SASS workflow.”*

**Eleven years later, we don't need Sass to do it.**

See [LICENSE](LICENSE) for the original licence.
