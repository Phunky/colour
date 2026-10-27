# colour

> **11 years later, we can finally do this without Sass!**

In 2015, `colour` was an opinionated way to use named colours inside Sass. Now native CSS functions, relative colour syntax and `color-mix()` can bring the same idea to the browser, **without Sass or browser-side JavaScript**.

**[Try the interactive demo](https://phunky.github.io/colour/)** · [Native CSS version](https://phunky.github.io/colour/index-native.html)

## From Sass to CSS

The original `_colour.scss` is still available, unchanged, for existing projects. The new [`src/colour.css`](./src/colour.css) defines the entire 21-colour palette **once**, inside `--colour()`. Every other function resolves its colour through `--colour()`, so there is a single source of truth and no global colour variables.

```css
button {
  --background: --colour-tone(
    65%,
    --colour-mix(35%, blue, purple)
  );
  background: var(--background);
  color: --colour-contrast(var(--background));
  &:hover {
    background: --colour-darken(10, var(--background));
  }
  &:disabled {
    background: --colour-fade(0.4, var(--background));
  }
}
.alert {
  color: --colour(red);
  background: --colour-tint(85%);
  border-color: --colour-accent(700);
}
```

Small, independent functions that combine like functional programming: every function returns a colour, and every colour argument accepts another function's result.

## The API

Three rules:

1. **Transformation first, colour last.** Every manipulation takes its adjustment as the first argument and an optional colour as the second.
2. **`currentColor` by default.** Omit the colour and the function uses the element's computed `color`. The two exceptions are `--colour-mix()`, which needs both colours, and `--colour-contrast()`, which needs the background.
3. **Any CSS colour.** The colour can be a palette name, a hex, `rgb()`, `hsl()`, `oklch()`, `color-mix()`, `light-dark()`, `currentColor`, a `var()`, or the result of another colour function. Every colour argument is resolved through `--colour()`.

| Function | Signature | Notes |
| --- | --- | --- |
| `--colour` | `(colour = currentColor)` | Palette lookup; any other colour passes through |
| `--colour-lighten` | `(amount, colour = currentColor)` | HSL lightness + amount points |
| `--colour-darken` | `(amount, colour = currentColor)` | HSL lightness − amount points |
| `--colour-saturate` | `(amount, colour = currentColor)` | HSL saturation + amount points |
| `--colour-desaturate` | `(amount, colour = currentColor)` | HSL saturation − amount points |
| `--colour-adjust-hue` | `(degrees, colour = currentColor)` | Hue rotation (a number, no `deg`) |
| `--colour-tint` | `(percentage, colour = currentColor)` | sRGB mix with white |
| `--colour-shade` | `(percentage, colour = currentColor)` | sRGB mix with black |
| `--colour-rgba` | `(alpha, colour = currentColor)` | Sets alpha (0–1) |
| `--colour-opacity` | `(alpha, colour = currentColor)` | Alias of `--colour-rgba` |
| `--colour-fade` | `(multiplier, colour = currentColor)` | Multiplies the existing alpha, clamped to 0–1 |
| `--colour-tone` | `(lightness, colour = currentColor)` | Sets absolute OKLCH lightness (`0%`–`100%`) |
| `--colour-chroma` | `(multiplier, colour = currentColor)` | Multiplies OKLCH chroma (0 = grey, 1 = unchanged) |
| `--colour-mix` | `(weight, colour1, colour2)` | `color-mix(in oklch, …)`; `weight` is `colour2`'s share; both colours **required** |
| `--colour-accent` | `(level, colour = currentColor)` | Levels 50, 100…900, 1000 (500 = base) |
| `--colour-contrast` | `(background)` | Black or white text for that background, via native `contrast-color()`. The background is **required** |

Every function returns a CSS `<color>`, so its result can be used directly as another function's colour.

### Palette names and other colours

The 21 palette names are `red`, `pink`, `purple`, `deep-purple`, `indigo`, `blue`, `light-blue`, `cyan`, `teal`, `green`, `light-green`, `lime`, `yellow`, `amber`, `orange`, `deep-orange`, `brown`, `grey`, `blue-grey`, `black` and `white`. They **take precedence** over CSS named colours, so `--colour(red)` is `#f44336`, not `#ff0000`. Anything else passes through unchanged:

```css
background: --colour-darken(15, #6750a4);
background: --colour-tint(25%, oklch(60% 0.2 250));
background: --colour-saturate(10, rgb(255 87 34));
background: --colour-lighten(10, rebeccapurple);
```

### Implicit `currentColor`

```css
.badge {
  color: --colour(purple);
  background: --colour-tint(88%);
  border: 1px solid --colour-shade(25%);
}
.link:hover {
  color: --colour-darken(10);
}
```

Results stay **dynamic**. `currentColor` is resolved by the browser against the element's computed `color`, so derived colours update on `:hover`, through inheritance, or whenever `color` changes. Inside the `color` property itself, `currentColor` refers to the inherited colour. `--colour()` with no argument is simply `currentColor`.

### CSS custom properties

```css
:root { --brand: --colour(teal); }

.card {
  background: --colour-lighten(10, var(--brand));
  border-color: --colour-shade(20%, var(--brand, #6750a4));
}
```

### Functional composition

Pass one function's result as another's colour. Nested calls are evaluated from the innermost outwards, and no intermediary variables are needed.

```css
background: --colour-opacity(
  0.8,
  --colour-lighten(15, blue)
);

background: --colour-opacity(
  0.8,
  --colour-saturate(
    20,
    --colour-darken(10, blue)
  )
);

/* Composition with implicit currentColor */
background: --colour-opacity(
  0.5,
  --colour-lighten(20)
);

/* Arguments with their own commas are fine */
background: --colour-tint(
  10%,
  color-mix(in srgb, --colour(red), --colour(amber) 40%)
);

/* HSL, OKLCH and alpha functions mix freely */
background: --colour-darken(
  15,
  --colour-tone(
    70%,
    --colour-chroma(0.8, --colour-mix(40%, purple, blue))
  )
);
```

A whole component can derive its colours from one base value:

```css
.card {
  --background: --colour-tone(
    70%,
    --colour-chroma(0.8, --colour-mix(40%, purple, blue))
  );
  background: var(--background);
  color: --colour-contrast(var(--background));
  border-color: --colour-darken(15, var(--background));
}
```

### HSL or OKLCH?

The original functions keep their Sass behaviour: `--colour-lighten()`, `--colour-darken()`, `--colour-saturate()`, `--colour-desaturate()` and `--colour-accent()` shift **HSL** values by **relative** points, and `--colour-tint()`/`--colour-shade()` mix in sRGB. HSL lightness isn't perceptual. HSL 50% yellow looks far lighter than HSL 50% blue, and `--colour-lighten(20)` changes them by very different visible amounts.

The OKLCH functions work on perceived lightness and colourfulness:

- `--colour-tone(70%, blue)` sets the **absolute** OKLCH lightness to 70% and keeps hue, chroma and alpha, so `--colour-tone(70%, yellow)` and `--colour-tone(70%, blue)` look equally light.
- `--colour-chroma(0.5, blue)` halves the chroma and keeps lightness, hue and alpha. `0` gives a grey of the same lightness, and values above 1 intensify.
- `--colour-mix(30%, red, blue)` is `color-mix(in oklch, red, blue 30%)`: 70% of `red` and 30% of `blue`, with alpha premultiplied and hue taking the shorter arc. Black, white and greys have no hue in OKLCH, so mixing with them keeps the other colour's hue instead of drifting through unrelated hues.

**Out-of-gamut results.** OKLCH can describe colours a screen can't show. A strong blue at 85% lightness, or a large chroma multiplier, is outside sRGB. The functions return the exact OKLCH colour and leave display to the browser. Chromium and WebKit currently **clip** such colours to the gamut rather than gamut-mapping them, so a saturated colour keeps a tint at extreme tones: `--colour-tone(100%, blue)` renders as `rgb(157, 255, 255)`, not white. Reduce chroma too (`--colour-tone(95%, --colour-chroma(0.3, blue))`) for near-white or near-black tints.

### Opacity or fade?

`--colour-opacity()` (and `--colour-rgba()`) **sets** the alpha. `--colour-fade()` **multiplies** it, clamped to 0–1:

```css
--colour-opacity(0.5, --colour-opacity(0.6, blue)) /* alpha 0.5 */
--colour-fade(0.5, --colour-opacity(0.6, blue))    /* alpha 0.3 */
--colour-fade(0.5, blue)                           /* alpha 0.5: opaque × 0.5 */
--colour-fade(3, --colour-opacity(0.6, blue))      /* alpha 1, clamped */
```

Use fade for states such as `:disabled` where the input may already be translucent.

### Light and dark themes

There is no theme API. `light-dark()` and `color-scheme` already do the work, and every library function accepts `light-dark()` or a custom property holding it:

```css
:root { color-scheme: light dark; }

.card {
  --background: light-dark(
    --colour(white),
    --colour-tone(25%, blue-grey)
  );
  background: var(--background);
  color: --colour-contrast(var(--background));
  border-color: --colour-tone(70%, --colour-chroma(0.5, var(--background)));
}
```

The demo's theme switch is CSS-only: three radio inputs and `:has()` set `color-scheme` to `light`, `dark` or `light dark` (follow the operating system), and everything else re-resolves.

### Automatic text contrast

`--colour-contrast(background)` resolves the background through `--colour()` and passes it to the browser's native [`contrast-color()`](https://drafts.csswg.org/css-color-5/#contrast-color). The result is **black or white**, whichever contrasts more with that background. Pair it with the same expression you use for the background:

```css
.button {
  background: --colour(blue);
  color: --colour-contrast(blue);
}
.brand {
  background: #6750a4;
  color: --colour-contrast(#6750a4);
}
.card {
  background: var(--background);
  color: --colour-contrast(var(--background));
}
.button:hover {
  background: --colour-darken(15, blue);
  color: --colour-contrast(--colour-darken(15, blue));
}
.overlay {
  background: --colour-opacity(0.8, --colour-lighten(20, red));
  color: --colour-contrast(--colour-opacity(0.8, --colour-lighten(20, red)));
}
```

Things to know:

- **Black or white only.** It chooses the more readable of the two, and the library doesn't add a second contrast algorithm. The browser tests check that Chromium and WebKit currently choose exactly as the WCAG 2.x contrast ratio does. It doesn't pick complementary or brand colours, and it doesn't guarantee a particular ratio. Mid-tones such as `#767676` reach only about 4.5:1 either way, and `--colour(blue)` gets black (6.7:1) rather than white (3.1:1).
- **The background is required.** Unlike the other functions it has no `currentColor` default: the text colour is the thing being chosen, so it can't also be the input. `--colour-contrast()` fails the compiled build. Natively it is invalid and the property falls back to its inherited or initial value.
- **Alpha is ignored.** `contrast-color()` treats a translucent background as opaque, without considering what is behind it. `--colour-opacity(0.2, black)` gets white text (21:1 against opaque black), but composited over white the real ratio is about 1.6:1. Use it with opaque or nearly opaque backgrounds.
- **It only sees the colour you pass in.** Gradients, images, `backdrop-filter`, shadows and overlapping elements are invisible to it. Pass the colour that actually sits behind the text, and still test real designs for accessibility, especially with transparency, gradients or images.
- **It doesn't make a design accessible on its own.** It doesn't account for text size or weight, focus indicators, non-text contrast, or anything else WCAG covers.

### Accessibility table

The demo's accessibility section lists all 21 palette colours with their `--colour-contrast()` text, the WCAG 2.x contrast ratio, and whether it passes AA (4.5:1) and AAA (7:1) for normal-size text. The rows are generated by `scripts/build.cjs` using the WCAG 2.x relative-luminance formula; none are written by hand. Ratios are truncated to two decimals and thresholds compared without rounding. They apply only to those exact opaque colour pairs. A row that can't be computed reliably says so instead of estimating: translucent or runtime backgrounds, colours outside sRGB, and near-ties within 0.5%.

## Migrating from the previous argument order

This is an intentional breaking change for the native CSS API; the original Sass API in `_colour.scss` is untouched. Swap the two arguments, and drop the colour wherever it should follow `currentColor`.

| Before | After |
| --- | --- |
| `--colour-lighten(blue, 10)` | `--colour-lighten(10, blue)` |
| `--colour-darken(var(--brand), 15)` | `--colour-darken(15, var(--brand))` |
| `--colour-tint(red, 85%)` | `--colour-tint(85%, red)` |
| `--colour-opacity(black, 0.5)` | `--colour-opacity(0.5, black)` |
| `--colour-accent(red, 700)` | `--colour-accent(700, red)` |
| `--colour-lighten(currentColor, 20)` | `--colour-lighten(20)` |
| `--colour(currentColor)` | `--colour()` |

## Native and Safari-compatible builds

The library itself is **native CSS** ([`src/colour.css`](./src/colour.css)): custom `@function`, `if(style())`, relative colour syntax, `color-mix()` and `contrast-color()`. It needs a browser with CSS custom functions (Chrome/Edge 139+), and `--colour-contrast()` also needs `contrast-color()`. Playwright's WebKit 27.2 build also passes every native check, but shipping Safari releases may lag behind it.

For browsers without custom functions, the **default demo** is compiled at build time by [`scripts/compiler.cjs`](./scripts/compiler.cjs) into plain CSS using relative colours, `color-mix()` and `:has()`. The compiler parses values into balanced function calls, compiles nested calls innermost-first at any depth, substitutes `currentColor` for omitted colours, resolves palette names from `src/colour.css`, and passes `currentColor`, `var()` (with fallbacks) and other colours through untouched. Malformed or unsupported calls fail the build instead of generating incorrect CSS.

Scope and differences:

- The compiler is a **build-time tool for this library and demo**, not a general-purpose `@function` polyfill. It only compiles the 16 `--colour*()` functions, and any other dashed function fails the build. It also rejects the wrong number of arguments, amounts of the wrong type, and literal amounts outside their range (`--colour-tone(150%)`, `--colour-mix(130%, …)`, negative chroma or fade). The build currently applies it to `src/demo.css` and the demo's inline styles.
- Palette names are resolved at build time, so they must appear literally. In the native build, `--colour(var(--x))` where `--x: blue` gives the palette blue; in the compiled build it gives CSS `blue`. Store resolved colours in custom properties instead (`--x: --colour(blue)`), as the demo does.
- The compiled accent level must be a literal (`50`…`1000`). Amounts can be numbers, percentages, `calc()` or `var()`.
- OKLCH functions compile to the same native CSS (`oklch(from …)`, `color-mix(in oklch, …)`), so the browser still does the colour maths at runtime and `currentColor` and `var()` stay dynamic.
- Both demos use only CSS at runtime. The compiled output targets browsers with relative colour syntax, `color-mix()`, `light-dark()` and `:has()` (iOS Safari 18+, Firefox 133+, Chromium 131+); it is not a legacy-browser polyfill. The demo's black/white labels also use `@container style()` queries, which Firefox doesn't support yet; the text colours themselves still work.

### `--colour-contrast()` in the compiled build

The compiler keeps the browser's own `contrast-color()` and adds a fallback for browsers that lack it:

```css
/* source */
.chip { background: --colour(yellow); color: --colour-contrast(yellow); }

/* compiled */
.chip { background: #ffeb3b; color: #000; }
@supports (color: contrast-color(red)) {
  .chip { color: contrast-color(#ffeb3b); }
}
```

- **Static backgrounds get a build-time fallback.** These are palette names, hex, `transparent`, literal `rgb()`/`hsl()` and any library transform of them, including the OKLCH functions, such as `--colour-darken(15, blue)` or `--colour-tone(30%, blue-grey)`. The compiler evaluates the colour (its sRGB/HSL/OKLCH maths matches Chromium's rendering in the browser tests), computes WCAG 2.x relative luminance, and picks black or white, ignoring alpha just as `contrast-color()` does. The browser tests check every one of these fallbacks against native `contrast-color()` in Chromium and WebKit.
- **`light-dark()` of two static colours** gets `light-dark(<black or white>, <black or white>)`.
- **Some backgrounds get no guess.** The compiler doesn't pretend to evaluate `var()`, `currentColor`, literal `oklch()`/`lab()`, plain `color-mix()`, `calc()` amounts or anything else known only at runtime. It also refuses results outside the sRGB gamut, where the browser's own handling decides, and near-ties within 0.5%. In these cases it emits only the `@supports` rule, so declare your own fallback first:

  ```css
  .card {
    color: light-dark(#000, #fff); /* used where contrast-color() is unsupported */
    color: --colour-contrast(var(--background));
  }
  ```

- `@supports` blocks are only generated for declarations in ordinary style rules, and a compiled inline `style=""` attribute must have a static background. Both cases fail the build if not satisfied.
- Without `contrast-color()`, the text colour no longer follows runtime changes to the background, for example a custom property changed on `:hover`.

### Known engine limitations

- **Chromium: a function nested inside itself is invalid.** For example, `--colour-lighten(10, --colour-lighten(10, red))`, `--colour-mix(50%, --colour-mix(50%, red, blue), teal)` or `--colour(--colour(red))`. The spec allows this; Chromium treats it as recursion ([w3c/csswg-drafts#13943](https://github.com/w3c/csswg-drafts/issues/13943), accepted as a spec bugfix). An invalid argument falls back to the default, `currentColor`. Composing *different* functions works at any depth, and the library's functions never call one another (only `--colour()`), so this only affects literal self-nesting. WebKit and the compiled build both handle self-nesting. `npm run test:browser` reports when Chromium fixes it.
- **Chromium: compiled `color: …currentColor…` doesn't update live.** In the compiled CSS, a `color` declaration derived from `currentColor` (for example `color: --colour-darken(10)`) is not recomputed when only the inherited colour changes later; a fresh render is correct. Other properties, the native build and WebKit all update correctly.

## Build and test

Requires Node.js 20+:

```sh
npm install
npm test                                   # build + compiler/unit checks
npx playwright install chromium webkit     # once
npm run test:browser                       # native vs compiled, rendered in Chromium and WebKit
```

`npm test` covers:

- every function with omitted, implicit and explicit `currentColor`, palette and arbitrary colours, and custom properties with fallbacks;
- deep and comma-heavy compositions;
- the static OKLCH, alpha and mix maths against known values;
- WCAG ratios, thresholds and the generated accessibility rows;
- contrast fallbacks, including `light-dark()`;
- the theme switch rules;
- failures on malformed calls, wrong argument counts and out-of-range amounts.

`npm run test:browser` renders 286 expressions natively and compiled, and compares computed colours (with tolerances for colour-space conversion and translucent readback):

- in Chromium, before and after changing the inherited `color`, and the compiled build again in WebKit;
- the compiler's build-time colours against what Chromium renders;
- behaviour checks: alpha multiplication and clamping, tone and chroma, and mix endpoints and hue handling.

For contrast it renders 40 backgrounds in both engines, requires native, compiled and static-fallback text colours to agree, and asserts that the chosen colour has the higher WCAG ratio. It then:

- compares both full demos across palette, mix and `currentColor` selections;
- exercises the theme switch in light, dark and system mode with a light and a dark OS setting;
- re-measures the accessibility table from rendered colours;
- reloads the compiled demo with `contrast-color()` disabled to check every fallback.

Feature support is detected first, so nothing is asserted for a feature an engine doesn't implement.

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

To compare the rendered demos, switch between the native and compatibility links in the banner at the top of the demo.

## GitHub Pages

Pushing to `master` runs the workflow in [`.github/workflows/pages.yml`](./.github/workflows/pages.yml). It runs both test suites (including WebKit), builds the demo and deploys `dist/`. The first deployment requires **Settings → Pages → Build and deployment → Source → GitHub Actions**.

Public URL: **https://phunky.github.io/colour/**

## Colour maths

Lighten/darken and saturate/desaturate adjust HSL values by percentage points. Tint and shade use sRGB colour mixing. Tone, chroma and mix use OKLCH, and fade multiplies alpha. Accent offsets follow the original Sass project's design and are not exact Material Design swatches. The new CSS relies on modern colour processing, so some converted results can differ slightly from historical Sass output.

## The original

The original README said: *“An opinionated way to manage and use colours within your SASS workflow.”*

**Eleven years later, we don't need Sass to do it.**

See [LICENSE](LICENSE) for the original licence.
