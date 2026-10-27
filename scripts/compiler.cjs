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
 * (palette names, hex, literal rgb()/hsl(), and library transformations of
 * those). --colour-contrast() uses that to offer a static black/white fallback,
 * chosen with the WCAG 2.1 contrast ratio, for browsers without contrast-color().
 * Runtime colours (var(), currentColor, other colour spaces) are never guessed.
 *
 * Scope: only the 12 library functions defined in src/colour.css are compiled.
 * It is NOT a general-purpose @function polyfill: any other dashed function
 * throws, and palette names can only be resolved where they appear literally
 * (a var() holding a palette name is passed through as a CSS colour).
 */

const SIGNATURES = {
  'colour-lighten': 'number',
  'colour-darken': 'number',
  'colour-saturate': 'number',
  'colour-desaturate': 'number',
  'colour-adjust-hue': 'number',
  'colour-tint': 'percentage',
  'colour-shade': 'percentage',
  'colour-rgba': 'number',
  'colour-opacity': 'number',
  'colour-accent': 'accent',
};

function readPalette(colourSource) {
  const fn = colourSource.match(/@function\s+--colour\([^]*?\n\}/);
  if (!fn) throw Error('Cannot locate --colour() source function');
  const palette = new Map();
  for (const [, name, hex] of fn[0].matchAll(/style\(--value:\s*([\w-]+)\):\s*(#[\da-fA-F]{3,8});/g)) {
    palette.set(name, hex);
  }
  if (palette.size !== 21) throw Error(`Expected 21 palette entries, found ${palette.size}`);
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

// WCAG 2.1 relative luminance and contrast ratio. contrast-color() ignores alpha.
function luminance({ r, g, b }) {
  const lin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
const contrastRatio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
function contrastChoice(background) {
  const l = luminance(background);
  return contrastRatio(l, 1) > contrastRatio(l, 0) ? '#fff' : '#000';
}

function createCompiler(colourSource) {
  const palette = readPalette(colourSource);
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
    const css = palette.get(ident) || ident;
    return { css, rgb: css.startsWith('#') ? parseHex(css) : null };
  }

  function resolveAmount(nodes, kind, call, mode) {
    const value = compileNodes(nodes, mode).css.trim();
    if (!value) throw Error(`${call}: missing amount`);
    if (kind === 'accent') {
      if (!accent.has(value)) throw Error(`${call}: accent level must be one of ${[...accent.keys()].join(', ')} (got "${value}")`);
      return { css: accent.get(value), number: parseFloat(accent.get(value)) };
    }
    if (/^(calc|var|min|max|clamp)\(/.test(value)) return { css: value, number: null };
    const number = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
    if (kind === 'number' && number.test(value)) return { css: value, number: parseFloat(value) };
    if (kind === 'percentage' && value.endsWith('%') && number.test(value.slice(0, -1))) {
      return { css: value, number: parseFloat(value) / 100 };
    }
    throw Error(`${call}: expected a ${kind}, got "${value}"`);
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
      if (!choice) throw new DynamicContrast(call);
      return { css: choice, rgb: parseHex(choice) };
    }
    return { css: `contrast-color(${base.css})`, rgb: choice ? parseHex(choice) : null };
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
    }
  }

  function compileLibraryCall(name, children, mode) {
    const call = `--${name}(${serialise(children)})`;
    const args = children.length ? splitArguments(children) : [];
    if (name === 'colour') {
      if (args.length > 1) throw Error(`${call}: expected at most 1 argument`);
      return resolveColour(args[0] || [], call, mode);
    }
    if (name === 'colour-contrast') return compileContrast(args, call, mode);
    const kind = SIGNATURES[name];
    if (!kind) throw Error(`Unsupported custom function --${name}()`);
    if (args.length < 1 || args.length > 2) throw Error(`${call}: expected 1 or 2 arguments`);
    if (args.length === 2 && !hasArgument(args[1])) {
      throw Error(`${call}: empty colour argument (omit it to use currentColor)`);
    }
    const amount = resolveAmount(args[0], kind, call, mode);
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
      'colour-accent': `hsl(from ${b} h s clamp(0, calc(l + ${a}), 100) / alpha)`,
    }[name];
    return { css, rgb };
  }

  function compileNode(node, mode) {
    if (node.type === 'comma') return { css: ',', rgb: null };
    if (node.type === 'text') {
      const text = node.value.trim();
      return { css: node.value, rgb: /^#[\da-fA-F]{3,8}$/.test(text) ? parseHex(text) : null };
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

  return { compileValue, compileFallback, usesContrast, palette, accent };
}

class DynamicContrast extends Error {}

module.exports = { createCompiler, parse, luminance, contrastRatio, parseHex };
