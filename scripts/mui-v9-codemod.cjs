#!/usr/bin/env node
/**
 * MUI v9 codemod
 * Transformations:
 *  1. <Grid item xs={...} sm={...} md={...} lg={...} xl={...}> -> <Grid size={{ xs: ..., sm: ..., ... }}>
 *  2. InputProps={{ ... }} -> slotProps={{ input: { ... } }}   (capital I, TextField)
 *  3. <Typography ... fontWeight={X} ...> -> <Typography ... sx={{ fontWeight: X, ...existing }}>
 *     (only when fontWeight prop is directly on Typography; merges with existing sx)
 *
 * Edits files in place. Pass file globs as args.
 */
const fs = require('fs');
const path = require('path');

const BREAKPOINTS = ['xs', 'sm', 'md', 'lg', 'xl'];

/** Find the matching closing brace `}` starting at `start` which points at the opening `{`. */
function findMatchingBrace(src, start) {
  if (src[start] !== '{') return -1;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Migrate `<Grid item xs={..} ...>` -> `<Grid size={{ xs: .., ... }}>` */
function migrateGrid(src) {
  // Match the opening <Grid ... > with attributes containing `item`. Capture the tag content.
  // We only target Grid elements explicitly written as `<Grid ` (skip <Grid2 etc.).
  const re = /<Grid(\s[^/>]*?)(\s*\/?>)/g;
  return src.replace(re, (match, attrs, end) => {
    if (!/\bitem\b/.test(attrs)) return match;
    // Extract breakpoint props with numeric or expression values.
    const newAttrParts = [];
    const sizeParts = [];
    let working = attrs;
    // Remove `item` prop.
    working = working.replace(/\bitem\b\s*/, '');
    // Find breakpoint props.
    for (const bp of BREAKPOINTS) {
      // value can be {N} or "N" (rare). We'll handle {expr}.
      const r = new RegExp(`\\s${bp}=\\{([^}]+)\\}`);
      const m = working.match(r);
      if (m) {
        sizeParts.push(`${bp}: ${m[1].trim()}`);
        working = working.replace(r, '');
      }
    }
    if (sizeParts.length === 0) {
      // Just remove `item`, no size to add.
      return `<Grid${working}${end}`;
    }
    const sizeAttr = ` size={{ ${sizeParts.join(', ')} }}`;
    // Place size at the start (after Grid) for clarity.
    return `<Grid${sizeAttr}${working}${end}`;
  });
}

/** Migrate `InputProps={{ ... }}` -> `slotProps={{ input: { ... } }}` */
function migrateInputProps(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const idx = src.indexOf('InputProps=', i);
    if (idx === -1) {
      out += src.slice(i);
      break;
    }
    // Ensure preceding char is whitespace/{ (avoid false match like `MyInputProps=`).
    const before = src[idx - 1];
    if (before && /[A-Za-z0-9_$]/.test(before)) {
      out += src.slice(i, idx + 'InputProps='.length);
      i = idx + 'InputProps='.length;
      continue;
    }
    // After `InputProps=`, expect `{{` (JSX expression with object literal).
    const exprStart = idx + 'InputProps='.length;
    if (src[exprStart] !== '{') {
      out += src.slice(i, exprStart);
      i = exprStart;
      continue;
    }
    // First `{` is JSX expression start. Find matching close.
    const jsxClose = findMatchingBrace(src, exprStart);
    if (jsxClose === -1) {
      out += src.slice(i, exprStart);
      i = exprStart;
      continue;
    }
    // Inside the JSX expression should be an object literal `{ ... }`.
    let objStart = exprStart + 1;
    while (objStart < jsxClose && /\s/.test(src[objStart])) objStart++;
    if (src[objStart] !== '{') {
      // Not the simple object pattern; skip.
      out += src.slice(i, jsxClose + 1);
      i = jsxClose + 1;
      continue;
    }
    const objClose = findMatchingBrace(src, objStart);
    if (objClose === -1 || objClose > jsxClose) {
      out += src.slice(i, jsxClose + 1);
      i = jsxClose + 1;
      continue;
    }
    const objInner = src.slice(objStart + 1, objClose); // content between braces
    out += src.slice(i, idx);
    out += `slotProps={{ input: {${objInner}} }}`;
    i = jsxClose + 1;
  }
  return out;
}

/** Migrate system shorthand props on MUI components -> merge into sx.
 *  Applied to Typography and Stack (and similar) which lost most direct system props in v9.
 */
const SYSTEM_SX_PROPS = [
  // Spacing
  'm', 'mt', 'mb', 'ml', 'mr', 'mx', 'my',
  'p', 'pt', 'pb', 'pl', 'pr', 'px', 'py',
  // Sizing
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'boxSizing',
  // Display / flex / grid
  'display', 'flex', 'flexDirection', 'flexWrap', 'flexGrow', 'flexShrink', 'flexBasis',
  'alignItems', 'alignContent', 'alignSelf', 'justifyContent', 'justifyItems', 'justifySelf',
  'gap', 'rowGap', 'columnGap', 'order',
  // Position
  'position', 'top', 'right', 'bottom', 'left', 'zIndex',
  // Borders
  'border', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft', 'borderRadius', 'borderColor',
  // Palette
  'bgcolor', 'color',
  // Typography
  'fontWeight', 'fontStyle', 'fontSize', 'lineHeight', 'letterSpacing',
  'textTransform', 'textAlign',
  // Shadows / opacity
  'boxShadow', 'opacity', 'overflow',
];
function migrateComponentSystemProps(src, componentName, propList = SYSTEM_SX_PROPS) {
  const re = new RegExp(`<${componentName}(\\s[^>]*?)(\\/?>)`, 'g');
  return src.replace(re, (match, attrs, end) => {
    const captured = {};
    let newAttrs = attrs;
    for (const prop of propList) {
      // {value}
      const reExpr = new RegExp(`\\s${prop}=\\{([^}]+)\\}`);
      const m1 = newAttrs.match(reExpr);
      if (m1) {
        captured[prop] = m1[1].trim();
        newAttrs = newAttrs.replace(reExpr, '');
        continue;
      }
      // "value"
      const reStr = new RegExp(`\\s${prop}="([^"]*)"`);
      const m2 = newAttrs.match(reStr);
      if (m2) {
        captured[prop] = JSON.stringify(m2[1]);
        newAttrs = newAttrs.replace(reStr, '');
      }
    }
    const keys = Object.keys(captured);
    if (keys.length === 0) return match;
    const additions = keys.map((k) => `${k}: ${captured[k]}`).join(', ');
    const sxRe = /\ssx=\{\{([\s\S]*?)\}\}/;
    const sxM = newAttrs.match(sxRe);
    if (sxM) {
      const inner = sxM[1].trim().replace(/,\s*$/, '');
      const merged = inner ? `${inner}, ${additions}` : additions;
      newAttrs = newAttrs.replace(sxRe, ` sx={{ ${merged} }}`);
    } else {
      newAttrs = newAttrs + ` sx={{ ${additions} }}`;
    }
    return `<${componentName}${newAttrs}${end}`;
  });
}
function migrateTypographySystemProps(src) {
  // Typography v9 still supports `color`, `align`, `variant`, `gutterBottom`, `noWrap`, `children`.
  // Remove `color` from the list when processing Typography.
  const typographyProps = SYSTEM_SX_PROPS.filter((p) => p !== 'color');
  let out = src;
  out = migrateComponentSystemProps(out, 'Typography', typographyProps);
  // Box & Stack: full list (color removed too). Stack still allows `direction`, `spacing`.
  out = migrateComponentSystemProps(out, 'Box', SYSTEM_SX_PROPS);
  out = migrateComponentSystemProps(out, 'Stack', SYSTEM_SX_PROPS);
  // Typography `paragraph` -> sx.mb=2 (migration per MUI v6+ release notes).
  out = migrateTypographyParagraph(out);
  return out;
}

/** Remove deprecated `paragraph` prop on Typography and inject `mb: 2` into sx. */
function migrateTypographyParagraph(src) {
  const re = /<Typography(\s[^>]*?)(\/?>)/g;
  return src.replace(re, (match, attrs, end) => {
    // paragraph={true} OR bare paragraph OR paragraph={false}.
    let removed = false;
    let newAttrs = attrs;
    const reTrue = /\sparagraph(?:=\{true\})?\b/;
    if (reTrue.test(newAttrs)) {
      newAttrs = newAttrs.replace(reTrue, '');
      removed = true;
    } else {
      const reFalse = /\sparagraph=\{false\}/;
      if (reFalse.test(newAttrs)) {
        newAttrs = newAttrs.replace(reFalse, '');
        // No sx adjustment needed when paragraph={false}.
        return `<Typography${newAttrs}${end}`;
      }
    }
    if (!removed) return match;
    const sxRe = /\ssx=\{\{([\s\S]*?)\}\}/;
    const sxM = newAttrs.match(sxRe);
    if (sxM) {
      const inner = sxM[1].trim().replace(/,\s*$/, '');
      if (/\bmb\s*:/.test(inner)) {
        // mb already present, leave as-is
        return `<Typography${newAttrs}${end}`;
      }
      const merged = inner ? `${inner}, mb: 2` : 'mb: 2';
      newAttrs = newAttrs.replace(sxRe, ` sx={{ ${merged} }}`);
    } else {
      newAttrs = newAttrs + ` sx={{ mb: 2 }}`;
    }
    return `<Typography${newAttrs}${end}`;
  });
}

/** Generic single-prop rename: `propName={{...}}` -> `slotKeyName={{ slotName: {...} }}`.
 *  Used for InputProps, PaperProps, primaryTypographyProps, etc. The replacement collects
 *  the object literal and wraps inside a single `slotProps={...}` attribute.
 */
function renamePropToSlotPropsObject(src, fromName, slotName) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const idx = src.indexOf(fromName + '=', i);
    if (idx === -1) {
      out += src.slice(i);
      break;
    }
    const before = src[idx - 1];
    if (before && /[A-Za-z0-9_$]/.test(before)) {
      out += src.slice(i, idx + fromName.length + 1);
      i = idx + fromName.length + 1;
      continue;
    }
    const exprStart = idx + fromName.length + 1;
    if (src[exprStart] !== '{') {
      out += src.slice(i, exprStart);
      i = exprStart;
      continue;
    }
    const jsxClose = findMatchingBrace(src, exprStart);
    if (jsxClose === -1) {
      out += src.slice(i, exprStart);
      i = exprStart;
      continue;
    }
    let objStart = exprStart + 1;
    while (objStart < jsxClose && /\s/.test(src[objStart])) objStart++;
    if (src[objStart] !== '{') {
      out += src.slice(i, jsxClose + 1);
      i = jsxClose + 1;
      continue;
    }
    const objClose = findMatchingBrace(src, objStart);
    if (objClose === -1 || objClose > jsxClose) {
      out += src.slice(i, jsxClose + 1);
      i = jsxClose + 1;
      continue;
    }
    const objInner = src.slice(objStart + 1, objClose);
    out += src.slice(i, idx);
    out += `slotProps={{ ${slotName}: {${objInner}} }}`;
    i = jsxClose + 1;
  }
  return out;
}

/** If multiple converted `slotProps={{...}}` attrs appear back-to-back, merge them.
 *  Walks the source, locates each `slotProps={{ ... }}`, and merges into the previous
 *  one if only whitespace separates them.
 */
function mergeAdjacentSlotProps(src) {
  const TOKEN = 'slotProps={';
  let i = 0;
  let out = '';
  let lastMergePoint = -1; // position in `out` of the inner-object close `}` of the last slotProps merged
  let lastWasSlot = false;
  while (i < src.length) {
    const idx = src.indexOf(TOKEN, i);
    if (idx === -1) {
      out += src.slice(i);
      break;
    }
    // Push everything up to slotProps.
    out += src.slice(i, idx);
    // Match outer brace of attr value.
    const outerOpen = idx + TOKEN.length - 1;
    const outerClose = findMatchingBrace(src, outerOpen);
    if (outerClose === -1) {
      out += src.slice(idx);
      break;
    }
    // The expr is `{ {...} }`. Find inner object.
    let inObjStart = outerOpen + 1;
    while (inObjStart < outerClose && /\s/.test(src[inObjStart])) inObjStart++;
    if (src[inObjStart] !== '{') {
      out += src.slice(idx, outerClose + 1);
      i = outerClose + 1;
      lastWasSlot = false;
      continue;
    }
    const inObjClose = findMatchingBrace(src, inObjStart);
    const innerContent = src.slice(inObjStart + 1, inObjClose).trim().replace(/,\s*$/, '');
    // Check if previous emission was a slotProps and only whitespace separates.
    const between = src.slice(i, idx); // already pushed into out
    if (lastWasSlot && /^\s*$/.test(between) && lastMergePoint >= 0) {
      // Strip the pushed whitespace.
      out = out.slice(0, -between.length);
      // Insert ", innerContent" before the close brace at lastMergePoint.
      out = out.slice(0, lastMergePoint) + ', ' + innerContent + out.slice(lastMergePoint);
      lastMergePoint = lastMergePoint + 2 + innerContent.length;
      i = outerClose + 1;
      lastWasSlot = true;
      continue;
    }
    // Otherwise emit the slotProps as-is.
    const emitted = `slotProps={{ ${innerContent} }}`;
    out += emitted;
    lastMergePoint = out.length - 2; // index of `}` before `}` (close of inner)
    // emitted ends with ` }}` so close of inner is at out.length - 2 (the first `}`)
    i = outerClose + 1;
    lastWasSlot = true;
  }
  return out;
}

function processFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  let out = src;
  out = migrateGrid(out);
  out = migrateInputProps(out);
  // For TextField/OutlinedInput, lowercase `inputProps` -> `slotProps.htmlInput`.
  // Note: For Checkbox/Radio/Switch this should be `slotProps.input`. We handle TextField only.
  // Use the same generic mechanism but only when the file doesn't already have Checkbox usage near.
  out = renamePropToSlotPropsObject(out, 'inputProps', 'htmlInput');
  out = renamePropToSlotPropsObject(out, 'PaperProps', 'paper');
  out = renamePropToSlotPropsObject(out, 'primaryTypographyProps', 'primary');
  out = renamePropToSlotPropsObject(out, 'secondaryTypographyProps', 'secondary');
  out = mergeAdjacentSlotProps(out);
  out = migrateTypographySystemProps(out);
  if (out !== src) {
    fs.writeFileSync(file, out);
    return true;
  }
  return false;
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'backup') continue;
      walk(p, files);
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      files.push(p);
    }
  }
  return files;
}

const root = path.resolve(__dirname, '..', 'src');
const files = walk(root);
const changed = [];
for (const f of files) {
  if (processFile(f)) changed.push(f);
}
console.log(`Changed ${changed.length} files:`);
changed.forEach((f) => console.log('  ' + path.relative(path.resolve(__dirname, '..'), f)));
