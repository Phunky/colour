#!/usr/bin/env node
/*
 * Builds the native and Safari-compatible demos into dist/.
 * Palette values and accent offsets are read exclusively from src/colour.css;
 * the compatibility CSS is produced by scripts/compiler.cjs at build time, so
 * neither demo needs browser-side JavaScript.
 */
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');
const { createCompiler, contrastReport } = require('./compiler.cjs');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, v) => fs.writeFileSync(path.join(root, p), v, 'utf8');
const colourSource = read('src/colour.css');
const demoSource = read('src/demo.css');
const { compileValue, compileFallback, usesContrast, staticColour, palette, accent } = createCompiler(colourSource);

/*
 * Accessibility table: one row per palette colour (plus a translucent example),
 * with the WCAG 2.x ratio of the background and the black/white text that
 * contrast-color() picks. Nothing is hand-written; uncomputable rows say why.
 */
const A11Y_EXTRA = ['--colour-opacity(0.6, indigo)'];
const truncate = ratio => (Math.floor(ratio * 100) / 100).toFixed(2);
function accessibilityRows() {
  return [...palette.keys(), ...A11Y_EXTRA].map(background => {
    const expr = background.startsWith('--') ? background : `--colour(${background})`;
    const report = contrastReport(staticColour(expr));
    const swatch = `<span class="a11y-sample" style="background: ${expr}; color: --colour-contrast(${background});">${palette.has(background) ? background : 'translucent'}</span>`;
    const name = palette.has(background) ? `<code>${background}</code> <code>${palette.get(background)}</code>` : `<code>${background}</code>`;
    const verdict = pass => `<span class="${pass ? 'a11y-pass' : 'a11y-fail'}">${pass ? 'Pass' : 'Fail'}</span>`;
    const cells = report.ratio === undefined
      ? `<td>—</td><td colspan="3"><span class="a11y-unknown">Not computed (${report.reason})</span></td>`
      : `<td><span class="a11y-ink" style="background: ${report.text};"></span>${report.text === '#fff' ? 'white' : 'black'} <code>${report.text}</code></td><td>${truncate(report.ratio)}:1</td><td>${verdict(report.aa)}</td><td>${verdict(report.aaa)}</td>`;
    const data = report.ratio === undefined ? '' : ` data-text="${report.text}" data-ratio="${report.ratio}"`;
    return `<tr data-background="${background}"${data}><td>${swatch}</td><td>${name}</td>${cells}</tr>`;
  }).join('\n');
}
const htmlSource = replaceOnce(read('src/index.html'), '<!-- build:accessibility -->', () => accessibilityRows());
const CONTRAST_SUPPORTS = '(color: contrast-color(red))';

/*
 * --colour-contrast() compiles to contrast-color() inside @supports, so older
 * browsers keep the rule's static WCAG fallback (when the background is known
 * at build time) or any fallback declared earlier by the author. Plain
 * cascade fallbacks are not enough: declarations containing var() and custom
 * properties are always valid at parse time.
 */
function compileContrast(decl, from) {
  const rule = decl.parent;
  if (rule.type !== 'rule') throw Error(`${from}: --colour-contrast() is only supported inside style rules`);
  let supports = rule.next();
  if (!(supports && supports.type === 'atrule' && supports.name === 'supports' && supports.params === CONTRAST_SUPPORTS && supports.first.selector === rule.selector)) {
    supports = postcss.atRule({ name: 'supports', params: CONTRAST_SUPPORTS });
    supports.append(postcss.rule({ selector: rule.selector }));
    rule.after(supports);
  }
  supports.first.append(decl.clone({ value: compileValue(decl.value) }));
  const fallback = compileFallback(decl.value);
  if (fallback === null) decl.remove();
  else decl.value = fallback;
}

function compileDeclarations(css, from) {
  const tree = postcss.parse(css, { from });
  tree.walkAtRules('function', rule => {
    // Demonstration-only feature detection; the compat build does not need it.
    if (!/^--native-supported\(/.test(rule.params)) throw Error(`Unexpected @function in ${from}: ${rule.params}`);
    rule.remove();
  });
  tree.walkDecls(decl => {
    if (decl.value.includes('--native-supported()')) { decl.remove(); return; }
    if (decl.parent.type === 'rule' && decl.parent.parent.type === 'atrule' && decl.parent.parent.params === CONTRAST_SUPPORTS) return;
    try {
      if (usesContrast(decl.value)) compileContrast(decl, from);
      else decl.value = compileValue(decl.value);
    } catch (error) {
      throw Error(`${from}:${decl.source.start.line} ${decl.prop}: ${error.message}`);
    }
  });
  return tree.toString();
}

const compatOutput = [
  '/* Generated from src/colour.css + src/demo.css by scripts/build.cjs. DO NOT EDIT. */',
  '/* iOS Safari 18+, Firefox 133+, Chromium 131+; no CSS @function or if() at runtime. contrast-color() is used where supported. */',
  compileDeclarations(demoSource, 'src/demo.css'),
].join('\n');
if (/@function\b|\bif\s*\(\s*style\(|--[\w-]+\(/.test(compatOutput.replace(/\/\*[^]*?\*\//g, ''))) {
  throw Error('Untransformed custom function in CSS compat output');
}

function compileInlineStyles(html) {
  return html.replace(/ style="([^"]*)"/g, (_, style) => {
    const rule = postcss.parse(`x{${style}}`, { from: 'src/index.html' }).first;
    const compiled = rule.nodes.map(d => {
      if (!usesContrast(d.value)) return `${d.prop}: ${compileValue(d.value)};`;
      const fallback = compileFallback(d.value);
      if (fallback === null || d.prop.startsWith('--')) {
        throw Error(`src/index.html inline ${d.prop}: --colour-contrast() needs a stylesheet rule unless its background is static and the property is not custom`);
      }
      return `${d.prop}: ${fallback}; ${d.prop}: ${compileValue(d.value)};`;
    }).join(' ');
    return ` style="${compiled}"`;
  });
}

function replaceOnce(html, search, replacement) {
  const next = html.replace(search, replacement);
  if (next === html) throw Error(`HTML template is missing expected content: ${search}`);
  return next;
}

// Both HTML modes use exactly the same DOM, varying only which stylesheet loads.
function buildHTML(mode, inline = false) {
  const compatMode = mode === 'compat';
  const sheets = compatMode ? ['demo.compat.css'] : ['colour.native.css', 'demo.native.css'];
  const styles = inline
    ? `<style>\n${compatMode ? compatOutput : colourSource + '\n' + demoSource}\n</style>`
    : sheets.map(p => `<link rel="stylesheet" href="${p}">`).join('\n  ');
  let html = compatMode ? compileInlineStyles(htmlSource) : htmlSource;
  html = replaceOnce(html, /  <link rel="stylesheet" href="colour\.css">\s*<link rel="stylesheet" href="demo\.css">/, () => `  ${styles}`);
  html = replaceOnce(html, /<div class="support-warning" role="note">[^]*?<\/div>/, compatMode
    ? '<div class="support-warning" role="note"><strong>Compatibility CSS:</strong> This build works without native <code>@function</code> or <code>if()</code>. Try every swatch, transformation and composition on iOS Safari. <a href="index-native.html">View native build</a>.</div>'
    : '<div class="support-warning" role="note"><strong>Native CSS:</strong> This build requires <code>@function</code> and <code>if()</code> (Chrome/Edge 139+). <a href="index.html">Use Safari-compatible build</a>.</div>');
  if (compatMode) {
    html = replaceOnce(html, 'A pure CSS playground for colour, an experimental native CSS colour function library.',
      'A CSS-only playground for colour, including a WebKit-compatible build of native functions.');
    html = replaceOnce(html, 'The styling is powered entirely by native functions.',
      'The styling uses build-time compiled functions, with no browser-side JavaScript.');
    html = replaceOnce(html, 'The complete colour toolkit, rebuilt around native CSS functions. One source of truth. Every shade computed by the browser. No Sass, no JavaScript.',
      'The complete colour toolkit, built from native CSS functions. One palette source, a compatibility build, and every shade still computed by CSS. No Sass or browser JavaScript.');
    html = replaceOnce(html, '0 JavaScript · Single source of colour truth · Requires CSS custom functions',
      '0 browser JavaScript · Single palette source · Safari-compatible CSS');
    html = replaceOnce(html, '<span class="brand-name">colour<span> / native CSS</span></span>',
      '<span class="brand-name">colour<span> / compatible CSS</span></span>');
    html = replaceOnce(html, '<span class="eyebrow-pill">:has() + @function</span>',
      '<span class="eyebrow-pill">:has() + build-time compiler</span>');
  }
  return html;
}

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
write('dist/colour.native.css', colourSource);
write('dist/demo.native.css', demoSource);
write('dist/demo.compat.css', compatOutput);
write('dist/index.html', buildHTML('compat'));
write('dist/index-native.html', buildHTML('native'));
write('dist/standalone-compatible.html', buildHTML('compat', true));
write('dist/standalone-native.html', buildHTML('native', true));
console.log(`Built CSS/HTML for ${palette.size} colours and ${accent.size} accents; compatibility CSS has no native custom-function calls.`);
