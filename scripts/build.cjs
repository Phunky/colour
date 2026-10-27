#!/usr/bin/env node
/*
 * A PostCSS build-time compatibility transform, specialised for Phunky/colour.
 * It is deliberately NOT a general-purpose CSS @function polyfill.
 * Palette values + accent offsets are read exclusively from src/colour.css.
 * Rewrites documented function call sites in src/demo.css, preserving CSS-only
 * :has() interactions, relative HSL calculations, and colour mixing.
 */
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const read = p => fs.readFileSync(path.join(root,p), 'utf8');
const write = (p,v) => fs.writeFileSync(path.join(root,p),v,'utf8');
const colourSource = read('src/colour.css');
const demoSource = read('src/demo.css');
const htmlSource = read('src/index.html');

const colourFunction = colourSource.match(/@function\s+--colour\(--name[^]*?\n\}/);
if (!colourFunction) throw Error('Cannot locate --colour() source function');
const palette = new Map();
for (const [, name, hex] of colourFunction[0].matchAll(/style\(--name:\s*([\w-]+)\):\s*(#[\da-fA-F]{3,8});/g)) {
  palette.set(name,hex);
}
if (palette.size !== 21) throw Error(`Expected 21 palette entries, found ${palette.size}`);
const accentFn = colourSource.match(/@function\s+--colour-accent\([^]*?\n\}/);
if (!accentFn) throw Error('Cannot locate --colour-accent() source function');
const accent = new Map();
for (const [, level, offset] of accentFn[0].matchAll(/style\(--level:\s*(\d+)\):\s*(-?[\d.]+)\s*;?/g)) {
  accent.set(level,offset);
}
if (accent.size !== 11) throw Error(`Expected 11 accent offsets, found ${accent.size}`);

// Extract args by depth so var(), calc(), etc. do not split incorrectly.
function splitArgs(str) {
  const out = []; let depth = 0, last = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '(') depth++;
    else if (str[i] === ')') depth--;
    else if (str[i] === ',' && depth === 0) { out.push(str.slice(last,i).trim()); last = i+1; }
  }
  out.push(str.slice(last).trim());
  return out;
}
function closingParen(text, open) {
  let depth = 0;
  for (let i=open; i<text.length; i++) {
    if (text[i] === '(') depth++;
    if (text[i] === ')' && --depth === 0) return i;
  }
  throw Error(`Unclosed function in ${text}`);
}
const known = new Set(['colour','colour-lighten','colour-darken','colour-saturate',
  'colour-desaturate','colour-adjust-hue','colour-tint','colour-shade',
  'colour-rgba','colour-opacity','colour-accent']);
function resolveName(name) {
  if (name === 'currentColor') return 'currentColor';
  if (name === 'var(--active)') return 'var(--colour-active)';
  if (name === 'var(--token)') return 'var(--colour-selected-swatch)';
  const colour = palette.get(name);
  if (!colour) throw Error(`Unknown palette name ${name}`);
  return colour;
}
function transformFunction(name, argsStr) {
  const args = splitArgs(argsStr);
  if (name === 'colour') {
    if (args.length !== 1) throw Error(`${name}: expected 1 argument`);
    return resolveName(args[0]);
  }
  if (args.length !== 2) throw Error(`${name}: expected 2 arguments`);
  const [token,amount] = args;
  const base = resolveName(token);
  if (!/^-?[\d.]+%?$/.test(amount)) throw Error(`Unsupported amount ${amount}`);
  if (name === 'colour-tint') return `color-mix(in srgb, ${base}, white ${amount})`;
  if (name === 'colour-shade') return `color-mix(in srgb, ${base}, black ${amount})`;
  if (name === 'colour-rgba' || name === 'colour-opacity') return `rgb(from ${base} r g b / ${amount})`;
  if (name === 'colour-accent') {
    const offset = accent.get(amount);
    if (offset === undefined) throw Error(`Unknown accent ${amount}`);
    return `hsl(from ${base} h s clamp(0, calc(l + ${offset}), 100) / alpha)`;
  }
  if (name === 'colour-lighten') return `hsl(from ${base} h s clamp(0, calc(l + ${amount}), 100) / alpha)`;
  if (name === 'colour-darken') return `hsl(from ${base} h s clamp(0, calc(l - ${amount}), 100) / alpha)`;
  if (name === 'colour-saturate') return `hsl(from ${base} h clamp(0, calc(s + ${amount}), 100) l / alpha)`;
  if (name === 'colour-desaturate') return `hsl(from ${base} h clamp(0, calc(s - ${amount}), 100) l / alpha)`;
  if (name === 'colour-adjust-hue') return `hsl(from ${base} calc(h + ${amount}) s l / alpha)`;
  throw Error(`Unhandled function ${name}`);
}
function replaceCalls(value) {
  // Replace from left to right, respecting paren nesting and gradient/shorthand values.
  const re = /--(colour(?:-[a-z-]+)?)\(/g;
  let result = '', prev = 0, match;
  while ((match = re.exec(value))) {
    const shortName = match[1];
    if (!known.has(shortName)) throw Error(`Unexpected function ${shortName}`);
    const open = re.lastIndex - 1;
    const end = closingParen(value,open);
    result += value.slice(prev,match.index) + transformFunction(shortName,value.slice(open+1,end));
    prev = end+1; re.lastIndex = end+1;
  }
  return result + value.slice(prev);
}

const compat = postcss.parse(demoSource,{from:'src/demo.css'});
compat.walkAtRules('function', a => {
  // Demonstration-only feature-detection function; compat build does not need it.
  if (!/--native-supported/.test(a.params)) throw Error(`Unexpected demo-local @function: ${a.params}`);
  a.remove();
});
compat.walkDecls(decl => {
  if (decl.value.includes('--native-supported()')) { decl.remove(); return; }
  if (decl.value.includes('--colour')) decl.value = replaceCalls(decl.value);
});
const compatOutput = [
  '/* Generated from src/colour.css + src/demo.css by scripts/build.cjs. DO NOT EDIT. */',
  '/* iOS Safari 18+, Firefox 133+, Chromium 131+; no CSS @function or if() at runtime. */',
  '/* The following declarations are derived from the single native palette source. */',
  'main { --colour-active: ' + palette.get('blue') + '; }',
  ...[...palette].map(([name,hex]) => `main:has(#tone-${name}:checked) { --colour-active: ${hex}; }`),
  'main:has(#tone-currentColor:checked) { --colour-active: currentColor; }',
  ...[...palette].map(([name,hex]) => `#tone-${name} + .tone-dot { --colour-selected-swatch: ${hex}; }`),
  '#tone-currentColor + .tone-dot { --colour-selected-swatch: currentColor; }',
  compat.toString()
].join('\n');
if (compat.nodes.some(n => n.type === 'atrule' && n.name === 'function') || /\bif\s*\(style\(|--colour(?:-[a-z-]+)?\(/.test(compatOutput)) throw Error('Untransformed custom function in CSS compat output');
write('dist/colour.native.css',colourSource);
write('dist/demo.native.css',demoSource);
write('dist/demo.compat.css',compatOutput);
// Both HTML modes use exactly the same DOM, varying only which stylesheet loads.
function buildHTML(mode, inline = false) {
  let html = htmlSource;
  const compatMode = mode === 'compat';
  const sheets = compatMode ? ['demo.compat.css'] : ['colour.native.css','demo.native.css'];
  const styles = inline
    ? `<style>\n${compatMode ? compatOutput : colourSource+'\n'+demoSource}\n</style>`
    : sheets.map(p=>`<link rel="stylesheet" href="${p}">`).join('\n  ');
  html = html.replace(/  <link rel="stylesheet" href="colour\.css">\s*<link rel="stylesheet" href="demo\.css">/,`  ${styles}`);
  html = html.replace('A pure CSS playground for colour, an experimental native CSS colour function library.',
    'A CSS-only playground for colour, including a WebKit-compatible build of native functions.');
  html = html.replace(/<div class="support-warning" role="note">[^]*?<\/div>/,
    compatMode
    ? '<div class="support-warning" role="note"><strong>Compatibility CSS:</strong> This build works without native <code>@function</code> or <code>if()</code>. Try every swatch and transformation on iOS Safari. <a href="index-native.html">View native build</a>.</div>'
    : '<div class="support-warning" role="note"><strong>Native CSS:</strong> This build requires <code>@function</code> and <code>if()</code> (Chrome/Edge 139+). <a href="index.html">Use Safari-compatible build</a>.</div>');
  html = html.replace('The styling is powered entirely by native functions.', compatMode
    ? 'The styling uses build-time transpiled functions, with no browser-side JavaScript.'
    : 'The styling is powered entirely by native functions.');
  html = html.replace('The complete colour toolkit, rebuilt around native CSS functions. One source of truth. Every shade computed by the browser. No Sass, no JavaScript.',
    compatMode
    ? 'The complete colour toolkit, built from native CSS functions. One palette source, a compatibility build, and every shade still computed by CSS. No Sass or browser JavaScript.'
    : 'The complete colour toolkit, rebuilt around native CSS functions. One palette source of truth. Every shade computed by the browser. No Sass, no JavaScript.');
  html = html.replace('21 colours defined exactly once inside <code>--colour()</code>. No duplicate hex codes or global colour variables.',
    '21 colours maintained in one <code>--colour()</code> definition; compatibility values are generated automatically at build time.');
  html = html.replace('0 JavaScript · Single source of colour truth · Requires CSS custom functions',
    compatMode ? '0 browser JavaScript · Single palette source · Safari-compatible CSS' : '0 JavaScript · Single palette source · Native CSS custom functions');
  html = html.replace('<span class="brand-name">colour<span> / native CSS</span></span>',
    '<span class="brand-name">colour<span> / '+ (compatMode?'compatible CSS':'native CSS') +'</span></span>');
  html = html.replace('<span class="eyebrow-pill">:has() + @function</span>',
    '<span class="eyebrow-pill">'+ (compatMode ? ':has() + PostCSS build' : ':has() + @function') +'</span>');
  // Display rather than suppress the mode banner (native source had function-based hiding).
  html = html.replace('</body>','</body>');
  return html;
}
write('dist/index.html',buildHTML('compat'));
write('dist/index-native.html',buildHTML('native'));
write('dist/standalone-compatible.html',buildHTML('compat',true).replace('href="index-native.html"','href="index-native.html"'));
write('dist/standalone-native.html',buildHTML('native',true));
console.log(`Built CSS/HTML for ${palette.size} colours and ${accent.size} accents; compatibility CSS has no native custom-function calls.`);

module.exports = { transformFunction, replaceCalls, palette };
