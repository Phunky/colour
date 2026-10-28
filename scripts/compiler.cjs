'use strict';
/*
 * Build-time compatibility compiler for the colour library's --colour*() calls.
 *
 * It parses CSS values into a tree of balanced function calls, compiles nested
 * library calls from the innermost outwards, and emits standard CSS (relative
 * colour syntax, color-mix() and contrast-color()) for browsers without CSS
 * custom functions.
 *
 * Alongside the CSS it evaluates colours that are fully known at build time
 * (hex, literal rgb()/hsl(), optional named colours, and library
 * transformations of those, including the OKLCH ones). --colour-contrast()
 * uses that to offer a static black/white fallback, chosen with the WCAG 2.x
 * contrast ratio, for browsers without contrast-color(). Runtime colours
 * (var(), currentColor, other literal colour spaces), results outside the
 * sRGB gamut and near-ties are never guessed.
 *
 * Scope: only the 16 library functions defined in src/colour.css are compiled.
 * It is NOT a general-purpose @function polyfill: any other dashed function
 * throws. Named colours are optional: pass palette CSS (for example
 * examples/material.css) via createCompiler(source, { paletteSource }).
 * Unmapped identifiers keep their CSS meaning (so red is CSS red, not a
 * Material hex). A var() holding a name is passed through untouched.
 */

// Amount type of every (amount, colour = currentColor) function, with the
// literal range accepted where the CSS would otherwise be invalid or misleading.
const SIGNATURES = {
  'colour-lighten': { kind: 'number' },
  'colour-darken': { kind: 'number' },
  'colour-saturate': { kind: 'number' },
  'colour-desaturate': { kind: 'number' },
  'colour-adjust-hue': { kind: 'number' },
  'colour-tint': { kind: 'percentage' },
  'colour-shade': { kind: 'percentage' },
  'colour-rgba': { kind: 'number' },
  'colour-opacity': { kind: 'number' },
  'colour-fade': { kind: 'number', min: 0 },
  'colour-tone': { kind: 'percentage', min: 0, max: 1 },
  'colour-chroma': { kind: 'number', min: 0 },
  'colour-accent': { kind: 'accent' },
};
const MIX_RANGE = { kind: 'percentage', min: 0, max: 1 };

// CSS Color Level 4 named colours and keywords. Unmapped idents that are not
// in this set are treated as unresolved custom palette names and fail the build.
const CSS_COLOUR_KEYWORDS = new Set(`
  transparent currentcolor
  black silver gray grey white maroon red purple fuchsia magenta green lime
  olive yellow navy blue teal aqua cyan
  aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond
  blue blueviolet brown burlywood cadetblue chartreuse chocolate coral
  cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray
  darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid
  darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey
  darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue
  firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod
  gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki
  lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
  lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon
  lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue
  lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue
  mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen
  mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
  navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod
  palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum
  powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon
  sandybrown seagreen seashell sienna silver skyblue slateblue slategray
  slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet
  wheat white whitesmoke yellow yellowgreen
`.trim().split(/\s+/));

// Slice the first @function --colour(...) { ... } with balanced braces.
function extractColourFunction(source) {
  const start = source.search(/@function\s+--colour\s*\(/);
  if (start < 0) return null;
  const open = source.indexOf('{', start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < source.length && source[i] !== quote) i += source[i] === '\\' ? 2 : 1;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

// Reads style(--value: name): <any CSS colour expression>; entries from a
// --colour() @function. Values may be hex, named colours, var(), oklch(),
// light-dark(), color-mix(), etc. Empty when the source has no named colours.
function readPalette(source) {
  const palette = new Map();
  const fn = extractColourFunction(source);
  if (!fn) return palette;
  const re = /style\(\s*--value\s*:\s*([\w-]+)\s*\)\s*:/g;
  let match;
  while ((match = re.exec(fn))) {
    let i = match.index + match[0].length;
    while (i < fn.length && /\s/.test(fn[i])) i++;
    const start = i;
    let depth = 0;
    while (i < fn.length) {
      const ch = fn[i];
      if (ch === '"' || ch === "'") {
        const quote = ch;
        i++;
        while (i < fn.length && fn[i] !== quote) i += fn[i] === '\\' ? 2 : 1;
        i++;
        continue;
      }
      if (ch === '(') depth++;
      else if (ch === ')') {
        if (depth === 0) break;
        depth--;
      } else if (ch === ';' && depth === 0) break;
      i++;
    }
    const value = fn.slice(start, i).trim();
    if (!value) throw Error(`Palette entry "${match[1]}" has an empty colour value`);
    palette.set(match[1], value);
  }
  return palette;
}

function readAccents(colourSource) {
  const fn = colourSource.match(/@function\s+--colour-accent\([^]*?\n\}/);
  if (!fn) throw Error('Cannot locate --colour-accent() source function');
  const accent = new Map();
  for (const [, level, offset] of fn[0].matchAll(/style\(--level:\s*(\d+)\):\s*(-?[\d.]+)\s*;?/g)) {
    accent.set(level, offset);
  }
  if (accent.size !== 11) throw Error(`Expected 11 accent offsets, found ${accent.size}`);
  return accent;
}

// Nodes: { type: 'text', value } | { type: 'comma' } | { type: 'function', name, children }.
function parse(source) {
  let i = 0;
  function sequence(depth) {
    const nodes = [];
    let text = '';
    const flush = () => { if (text) nodes.push({ type: 'text', value: text }); text = ''; };
    while (i < source.length) {
      const ch = source[i];
      if (ch === '"' || ch === "'") {
        const start = i++;
        while (i < source.length && source[i] !== ch) i += source[i] === '\\' ? 2 : 1;
        if (i >= source.length) throw Error(`Unterminated string in "${source}"`);
        text += source.slice(start, ++i);
      } else if (ch === '/' && source[i + 1] === '*') {
        const end = source.indexOf('*/', i + 2);
        if (end === -1) throw Error(`Unterminated comment in "${source}"`);
        text += source.slice(i, end + 2);
        i = end + 2;
      } else if (ch === '(') {
        const name = (text.match(/(?:--|-?[A-Za-z_])[\w-]*$/) || [''])[0];
        text = text.slice(0, text.length - name.length);
        flush();
        i++;
        const children = sequence(depth + 1);
        if (source[i] !== ')') throw Error(`Unclosed "${name}(" in "${source}"`);
        i++;
        nodes.push({ type: 'function', name, children });
      } else if (ch === ')') {
        if (depth === 0) throw Error(`Unexpected ")" in "${source}"`);
        break;
      } else if (ch === ',') {
        flush();
        nodes.push({ type: 'comma' });
        i++;
      } else {
        text += ch;
        i++;
      }
    }
    flush();
    return nodes;
  }
  return sequence(0);
}

function splitArguments(children) {
  const args = [[]];
  for (const node of children) {
    if (node.type === 'comma') args.push([]);
    else args[args.length - 1].push(node);
  }
  return args;
}

function serialise(nodes) {
  return nodes.map(n => n.type === 'comma' ? ',' : n.type === 'text' ? n.value : `${n.name}(${serialise(n.children)})`).join('');
}

// Static colours are { r, g, b, alpha } with sRGB channels in 0–1.
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function parseHex(hex) {
  if (!/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(hex)) return null;
  let h = hex.slice(1);
  if (h.length <= 4) h = [...h].map(c => c + c).join('');
  const n = i => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), alpha: h.length === 8 ? n(6) : 1 };
}

function toHsl({ r, g, b }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return { h: h < 0 ? h + 360 : h, s: s * 100, l: l * 100 };
}

function fromHsl(h, s, l, alpha) {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return { r: f(0), g: f(8), b: f(4), alpha };
}

function mixSrgb(base, other, weight) {
  const alpha = base.alpha * (1 - weight) + other.alpha * weight;
  if (alpha === 0) return { r: 0, g: 0, b: 0, alpha: 0 };
  const channel = c => (base[c] * base.alpha * (1 - weight) + other[c] * other.alpha * weight) / alpha;
  return { r: channel('r'), g: channel('g'), b: channel('b'), alpha };
}

// Literal rgb()/hsl() only: numbers, percentages and deg, with optional alpha.
function parseColourFunction(name, text) {
  const parts = text.trim().split(/\s*\/\s*|\s*,\s*|\s+/);
  if (!/^(rgba?|hsla?)$/i.test(name) || parts.length < 3 || parts.length > 4) return null;
  const values = parts.map(p => p.match(/^([+-]?(?:\d+\.?\d*|\.\d+))(%|deg)?$/i));
  if (values.some(v => !v)) return null;
  const num = i => parseFloat(values[i][1]);
  const unit = i => (values[i][2] || '').toLowerCase();
  const alpha = parts.length === 4 ? clamp(unit(3) === '%' ? num(3) / 100 : num(3), 0, 1) : 1;
  if (/^rgb/i.test(name)) {
    const c = i => clamp(unit(i) === '%' ? num(i) / 100 : num(i) / 255, 0, 1);
    return { r: c(0), g: c(1), b: c(2), alpha };
  }
  return fromHsl(num(0), clamp(num(1), 0, 100), clamp(num(2), 0, 100), alpha);
}

// OKLab/OKLCH (Björn Ottosson's matrices, as used by CSS Color 4).
const toLinear = c => Math.sign(c) * (Math.abs(c) <= 0.04045 ? Math.abs(c) / 12.92 : ((Math.abs(c) + 0.055) / 1.055) ** 2.4);
const fromLinear = c => Math.sign(c) * (Math.abs(c) <= 0.0031308 ? 12.92 * Math.abs(c) : 1.055 * Math.abs(c) ** (1 / 2.4) - 0.055);
// Below this chroma the hue is powerless, so color-mix() treats it as missing.
const ACHROMATIC = 1e-4;
const GAMUT_EPSILON = 1e-4;

function toOklch({ r, g, b, alpha }) {
  const [lr, lg, lb] = [r, g, b].map(toLinear);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  const c = Math.hypot(A, B);
  return {
    l: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    c,
    h: c < ACHROMATIC ? NaN : (Math.atan2(B, A) * 180 / Math.PI + 360) % 360,
    alpha,
  };
}

// Returns null outside the sRGB gamut: the browser then gamut-maps for display,
// which a static evaluation should not try to predict.
function fromOklch({ l: L, c, h, alpha }) {
  const radians = (Number.isNaN(h) ? 0 : h) * Math.PI / 180;
  const A = c * Math.cos(radians);
  const B = c * Math.sin(radians);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ].map(fromLinear);
  if (rgb.some(v => v < -GAMUT_EPSILON || v > 1 + GAMUT_EPSILON)) return null;
  const [r, g, b] = rgb.map(v => clamp(v, 0, 1));
  return { r, g, b, alpha };
}

// color-mix(in oklch, a, b weight): premultiplied alpha, shorter hue arc, missing hues adopt the other colour's.
function mixOklch(a, b, weight) {
  const p = toOklch(a);
  const q = toOklch(b);
  const alpha = p.alpha * (1 - weight) + q.alpha * weight;
  if (alpha === 0) return { r: 0, g: 0, b: 0, alpha: 0 };
  let h1 = Number.isNaN(p.h) ? q.h : p.h;
  let h2 = Number.isNaN(q.h) ? p.h : q.h;
  if (h2 - h1 > 180) h1 += 360;
  else if (h2 - h1 < -180) h2 += 360;
  const premultiplied = k => (p[k] * p.alpha * (1 - weight) + q[k] * q.alpha * weight) / alpha;
  return fromOklch({ l: premultiplied('l'), c: premultiplied('c'), h: (h1 * (1 - weight) + h2 * weight) % 360, alpha });
}

// WCAG 2.x relative luminance and contrast ratio. contrast-color() ignores alpha.
const luminance = ({ r, g, b }) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
const contrastRatio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
// Too close to call (within 0.5%): floating-point or colour-space rounding in the
// browser could pick the other colour, so no static choice is offered.
const AMBIGUOUS = 0.005;
function contrastChoice(background) {
  const l = luminance(background);
  const white = contrastRatio(l, 1);
  const black = contrastRatio(l, 0);
  if (Math.abs(white - black) / Math.max(white, black) < AMBIGUOUS) return null;
  return white > black ? '#fff' : '#000';
}

function createCompiler(colourSource, options = {}) {
  // Optional named colours come from later --colour() sources; later entries win.
  const palette = new Map();
  for (const source of [colourSource, ...[].concat(options.paletteSource || [])]) {
    for (const [name, value] of readPalette(source)) palette.set(name, value);
  }
  const accent = readAccents(colourSource);

  // A colour argument must be one component value: an identifier, a hex colour or a single function.
  function resolveColour(nodes, call, mode) {
    const significant = nodes.filter(n => n.type === 'function' || n.value.trim());
    if (significant.length === 0) return { css: 'currentColor', rgb: null };
    const [only] = significant;
    if (significant.length > 1 || (only.type === 'text' && !/^\s*(#[\da-fA-F]{3,8}|-?[A-Za-z_][\w-]*)\s*$/.test(only.value))) {
      throw Error(`${call}: colour argument "${serialise(nodes).trim()}" is not a single CSS colour value`);
    }
    if (only.type === 'function') return compileNode(only, mode);
    const ident = only.value.trim();
    if (ident.startsWith('#')) {
      if (!parseHex(ident)) throw Error(`${call}: invalid hex colour "${ident}"`);
      return { css: ident, rgb: parseHex(ident) };
    }
    // Optional named colours may be any CSS colour expression, including var()
    // and native colour functions; compile the stored value so nested forms work.
    if (palette.has(ident)) return compileNodes(parse(palette.get(ident)), mode);
    if (CSS_COLOUR_KEYWORDS.has(ident.toLowerCase())) {
      return { css: ident, rgb: staticText(ident) };
    }
    throw Error(`${call}: unresolved colour name "${ident}". Define it in an optional --colour() palette (pass paletteSource to createCompiler), or use a CSS colour, hex value or var()`);
  }

  function staticText(text) {
    if (/^#[\da-fA-F]{3,8}$/.test(text)) return parseHex(text);
    if (/^transparent$/i.test(text)) return { r: 0, g: 0, b: 0, alpha: 0 };
    return null;
  }

  function resolveAmount(nodes, { kind, min = -Infinity, max = Infinity }, call, mode) {
    const value = compileNodes(nodes, mode).css.trim();
    if (!value) throw Error(`${call}: missing amount`);
    if (kind === 'accent') {
      if (!accent.has(value)) throw Error(`${call}: accent level must be one of ${[...accent.keys()].join(', ')} (got "${value}")`);
      return { css: accent.get(value), number: parseFloat(accent.get(value)) };
    }
    if (/^(calc|var|min|max|clamp)\(/.test(value)) return { css: value, number: null };
    const number = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
    let result = null;
    if (kind === 'number' && number.test(value)) result = { css: value, number: parseFloat(value) };
    if (kind === 'percentage' && value.endsWith('%') && number.test(value.slice(0, -1))) {
      result = { css: value, number: parseFloat(value) / 100 };
    }
    if (!result) throw Error(`${call}: expected a ${kind}, got "${value}"`);
    if (result.number < min || result.number > max) {
      const scale = kind === 'percentage' ? v => `${v * 100}%` : v => v;
      throw Error(`${call}: "${value}" is out of range (${max === Infinity ? `at least ${scale(min)}` : `${scale(min)} to ${scale(max)}`})`);
    }
    return result;
  }

  function hasArgument(nodes) {
    return nodes.some(n => n.type === 'function' || n.value.trim());
  }

  function compileContrast(args, call, mode) {
    if (args.length !== 1 || !hasArgument(args[0])) {
      throw Error(`${call}: expected exactly 1 background colour (it has no currentColor default)`);
    }
    const base = resolveColour(args[0], call, mode);
    const choice = base.rgb && contrastChoice(base.rgb);
    if (mode === 'fallback') {
      if (choice) return { css: choice, rgb: parseHex(choice) };
      const schemes = lightDarkChoices(args[0], mode);
      if (schemes) return { css: `light-dark(${schemes.join(', ')})`, rgb: null };
      throw new DynamicContrast(call);
    }
    return { css: `contrast-color(${base.css})`, rgb: choice ? parseHex(choice) : null };
  }

  // contrast(light-dark(a, b)) is light-dark(contrast(a), contrast(b)) when a and b are static.
  function lightDarkChoices(nodes, mode) {
    const significant = nodes.filter(n => n.type === 'function' || n.value.trim());
    if (significant.length !== 1 || significant[0].type !== 'function' || significant[0].name !== 'light-dark') return null;
    const branches = splitArguments(significant[0].children);
    if (branches.length !== 2) return null;
    const choices = branches.map(branch => {
      const { rgb } = compileNodes(branch, mode);
      return rgb && contrastChoice(rgb);
    });
    return choices.every(Boolean) ? choices : null;
  }

  function transform(name, amount, base) {
    const hsl = () => toHsl(base);
    const n = amount;
    switch (name) {
      case 'colour-lighten': { const c = hsl(); return fromHsl(c.h, c.s, clamp(c.l + n, 0, 100), base.alpha); }
      case 'colour-darken': { const c = hsl(); return fromHsl(c.h, c.s, clamp(c.l - n, 0, 100), base.alpha); }
      case 'colour-saturate': { const c = hsl(); return fromHsl(c.h, clamp(c.s + n, 0, 100), c.l, base.alpha); }
      case 'colour-desaturate': { const c = hsl(); return fromHsl(c.h, clamp(c.s - n, 0, 100), c.l, base.alpha); }
      case 'colour-adjust-hue': { const c = hsl(); return fromHsl(c.h + n, c.s, c.l, base.alpha); }
      case 'colour-accent': { const c = hsl(); return fromHsl(c.h, c.s, clamp(c.l + n, 0, 100), base.alpha); }
      case 'colour-tint': return mixSrgb(base, { r: 1, g: 1, b: 1, alpha: 1 }, n);
      case 'colour-shade': return mixSrgb(base, { r: 0, g: 0, b: 0, alpha: 1 }, n);
      case 'colour-rgba':
      case 'colour-opacity': return { ...base, alpha: clamp(n, 0, 1) };
      case 'colour-fade': return { ...base, alpha: clamp(base.alpha * n, 0, 1) };
      case 'colour-tone': return fromOklch({ ...toOklch(base), l: n });
      case 'colour-chroma': { const c = toOklch(base); return fromOklch({ ...c, c: c.c * n }); }
    }
  }

  function compileMix(args, call, mode) {
    if (args.length !== 3 || !args.every(hasArgument)) {
      throw Error(`${call}: expected a weight and 2 colours (both colours are required)`);
    }
    const weight = resolveAmount(args[0], MIX_RANGE, call, mode);
    const first = resolveColour(args[1], call, mode);
    const second = resolveColour(args[2], call, mode);
    const rgb = first.rgb && second.rgb && weight.number !== null ? mixOklch(first.rgb, second.rgb, weight.number) : null;
    return { css: `color-mix(in oklch, ${first.css}, ${second.css} ${weight.css})`, rgb };
  }

  function compileLibraryCall(name, children, mode) {
    const call = `--${name}(${serialise(children)})`;
    const args = children.length ? splitArguments(children) : [];
    if (name === 'colour') {
      if (args.length > 1) throw Error(`${call}: expected at most 1 argument`);
      return resolveColour(args[0] || [], call, mode);
    }
    if (name === 'colour-contrast') return compileContrast(args, call, mode);
    if (name === 'colour-mix') return compileMix(args, call, mode);
    const signature = SIGNATURES[name];
    if (!signature) throw Error(`Unsupported custom function --${name}()`);
    if (args.length < 1 || args.length > 2) throw Error(`${call}: expected 1 or 2 arguments`);
    if (args.length === 2 && !hasArgument(args[1])) {
      throw Error(`${call}: empty colour argument (omit it to use currentColor)`);
    }
    const amount = resolveAmount(args[0], signature, call, mode);
    const base = resolveColour(args[1] || [], call, mode);
    const rgb = base.rgb && amount.number !== null ? transform(name, amount.number, base.rgb) : null;
    const b = base.css;
    const a = amount.css;
    const css = {
      'colour-lighten': `hsl(from ${b} h s clamp(0, calc(l + ${a}), 100) / alpha)`,
      'colour-darken': `hsl(from ${b} h s clamp(0, calc(l - ${a}), 100) / alpha)`,
      'colour-saturate': `hsl(from ${b} h clamp(0, calc(s + ${a}), 100) l / alpha)`,
      'colour-desaturate': `hsl(from ${b} h clamp(0, calc(s - ${a}), 100) l / alpha)`,
      'colour-adjust-hue': `hsl(from ${b} calc(h + ${a}) s l / alpha)`,
      'colour-tint': `color-mix(in srgb, ${b}, white ${a})`,
      'colour-shade': `color-mix(in srgb, ${b}, black ${a})`,
      'colour-rgba': `rgb(from ${b} r g b / ${a})`,
      'colour-opacity': `rgb(from ${b} r g b / ${a})`,
      'colour-fade': `rgb(from ${b} r g b / clamp(0, calc(alpha * ${a}), 1))`,
      'colour-tone': `oklch(from ${b} ${a} c h / alpha)`,
      'colour-chroma': `oklch(from ${b} l max(0, c * ${a}) h / alpha)`,
      'colour-accent': `hsl(from ${b} h s clamp(0, calc(l + ${a}), 100) / alpha)`,
    }[name];
    return { css, rgb };
  }

  function compileNode(node, mode) {
    if (node.type === 'comma') return { css: ',', rgb: null };
    if (node.type === 'text') {
      const text = node.value.trim();
      return { css: node.value, rgb: staticText(text) };
    }
    if (node.name.startsWith('--')) return compileLibraryCall(node.name.slice(2), node.children, mode);
    const inner = compileNodes(node.children, mode).css;
    return { css: `${node.name}(${inner})`, rgb: parseColourFunction(node.name, inner) };
  }

  function compileNodes(nodes, mode) {
    const compiled = nodes.map(n => compileNode(n, mode));
    const significant = compiled.filter((c, i) => nodes[i].type === 'function' || c.css.trim());
    return { css: compiled.map(c => c.css).join(''), rgb: significant.length === 1 ? significant[0].rgb : null };
  }

  function compileValue(value) {
    return compileNodes(parse(value), 'css').css;
  }

  // Same value with every contrast-color() replaced by its static black/white
  // choice, or null when a background is only known at runtime.
  function compileFallback(value) {
    try {
      return compileNodes(parse(value), 'fallback').css;
    } catch (error) {
      if (error instanceof DynamicContrast) return null;
      throw error;
    }
  }

  const usesContrast = value => /--colour-contrast\(/.test(value);

  // The sRGB colour of a value when it is fully known at build time, otherwise null.
  const staticColour = value => compileNodes(parse(value), 'css').rgb;

  return { compileValue, compileFallback, usesContrast, staticColour, palette, accent };
}

class DynamicContrast extends Error {}

module.exports = { createCompiler };
