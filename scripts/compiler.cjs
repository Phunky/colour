'use strict';
/*
 * Build-time compatibility compiler for the colour library's --colour*() calls.
 *
 * It parses CSS values into a tree of balanced function calls, compiles nested
 * library calls from the innermost outwards, and emits standard CSS (relative
 * colour syntax and color-mix()) for browsers without CSS custom functions.
 *
 * Scope: only the 11 library functions defined in src/colour.css are compiled.
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

function createCompiler(colourSource) {
  const palette = readPalette(colourSource);
  const accent = readAccents(colourSource);

  // A colour argument must be one component value: an identifier, a hex colour or a single function.
  function resolveColour(nodes, call) {
    const significant = nodes.filter(n => n.type === 'function' || n.value.trim());
    if (significant.length === 0) return 'currentColor';
    const [only] = significant;
    if (significant.length > 1 || (only.type === 'text' && !/^\s*(#[\da-fA-F]{3,8}|-?[A-Za-z_][\w-]*)\s*$/.test(only.value))) {
      throw Error(`${call}: colour argument "${serialise(nodes).trim()}" is not a single CSS colour value`);
    }
    if (only.type === 'function') return compileNode(only);
    const ident = only.value.trim();
    return palette.get(ident) || ident;
  }

  function resolveAmount(nodes, kind, call) {
    const value = compileNodes(nodes).trim();
    if (!value) throw Error(`${call}: missing amount`);
    if (kind === 'accent') {
      if (!accent.has(value)) throw Error(`${call}: accent level must be one of ${[...accent.keys()].join(', ')} (got "${value}")`);
      return accent.get(value);
    }
    if (/^(calc|var|min|max|clamp)\(/.test(value)) return value;
    const number = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
    if (kind === 'number' && number.test(value)) return value;
    if (kind === 'percentage' && value.endsWith('%') && number.test(value.slice(0, -1))) return value;
    throw Error(`${call}: expected a ${kind}, got "${value}"`);
  }

  function compileLibraryCall(name, children) {
    const call = `--${name}(${serialise(children)})`;
    const args = children.length ? splitArguments(children) : [];
    if (name === 'colour') {
      if (args.length > 1) throw Error(`${call}: expected at most 1 argument`);
      return resolveColour(args[0] || [], call);
    }
    const kind = SIGNATURES[name];
    if (!kind) throw Error(`Unsupported custom function --${name}()`);
    if (args.length < 1 || args.length > 2) throw Error(`${call}: expected 1 or 2 arguments`);
    if (args.length === 2 && !args[1].some(n => n.type === 'function' || n.value.trim())) {
      throw Error(`${call}: empty colour argument (omit it to use currentColor)`);
    }
    const amount = resolveAmount(args[0], kind, call);
    const base = resolveColour(args[1] || [], call);
    switch (name) {
      case 'colour-lighten': return `hsl(from ${base} h s clamp(0, calc(l + ${amount}), 100) / alpha)`;
      case 'colour-darken': return `hsl(from ${base} h s clamp(0, calc(l - ${amount}), 100) / alpha)`;
      case 'colour-saturate': return `hsl(from ${base} h clamp(0, calc(s + ${amount}), 100) l / alpha)`;
      case 'colour-desaturate': return `hsl(from ${base} h clamp(0, calc(s - ${amount}), 100) l / alpha)`;
      case 'colour-adjust-hue': return `hsl(from ${base} calc(h + ${amount}) s l / alpha)`;
      case 'colour-tint': return `color-mix(in srgb, ${base}, white ${amount})`;
      case 'colour-shade': return `color-mix(in srgb, ${base}, black ${amount})`;
      case 'colour-rgba':
      case 'colour-opacity': return `rgb(from ${base} r g b / ${amount})`;
      case 'colour-accent': return `hsl(from ${base} h s clamp(0, calc(l + ${amount}), 100) / alpha)`;
    }
  }

  function compileNode(node) {
    if (node.type === 'comma') return ',';
    if (node.type === 'text') return node.value;
    if (node.name.startsWith('--')) return compileLibraryCall(node.name.slice(2), node.children);
    return `${node.name}(${compileNodes(node.children)})`;
  }

  function compileNodes(nodes) {
    return nodes.map(compileNode).join('');
  }

  function compileValue(value) {
    return compileNodes(parse(value));
  }

  return { compileValue, palette, accent };
}

module.exports = { createCompiler, parse };
