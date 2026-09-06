/**
 * Pre-compiles brain files from src/brains/ to .positronic/brains/.
 *
 * Each .ts and .tsx file is transpiled one to one, no bundling, so the
 * compiled files keep their relative imports (../brain.js, ../services/...)
 * and resolve them through the symlinks that mirror src/ into .positronic/.
 * Wrangler runs this as its build command and bundles the Worker afterwards.
 *
 * JSX text keeps its whitespace. Every JSX compiler collapses newlines in
 * text to single spaces, which destroys prompt templates, so before the
 * transform each JSXText node is wrapped in a template-literal expression
 * ({`...`}). oxc-parser locates the nodes; oxc-transform compiles the result.
 */
import { parseSync } from 'oxc-parser';
import { transformSync } from 'oxc-transform';
import { readdirSync, promises as fs } from 'fs';
import { dirname, join, relative } from 'path';

const SRC_BRAINS = '../src/brains';
const OUT_DIR = 'brains';

function formatErrors(fileName, errors) {
  return `${fileName}:\n${errors.map((error) => error.message).join('\n')}`;
}

// Wrap every JSXText node in {`...`} so its whitespace survives the JSX
// transform. Nodes are replaced from the end of the file backwards so
// earlier offsets stay valid.
function preserveJsxText(fileName, source) {
  const { program, errors } = parseSync(fileName, source);
  if (errors.length > 0) {
    throw new Error(formatErrors(fileName, errors));
  }

  const texts = [];
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (node.type === 'JSXText') texts.push(node);
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'type' && value && typeof value === 'object') visit(value);
    }
  };
  visit(program);

  let result = source;
  for (const { start, end } of texts.sort((a, b) => b.start - a.start)) {
    const escaped = source
      .slice(start, end)
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');
    result = `${result.slice(0, start)}{\`${escaped}\`}${result.slice(end)}`;
  }
  return result;
}

function compile(fileName, source) {
  const prepared = fileName.endsWith('.tsx')
    ? preserveJsxText(fileName, source)
    : source;
  const { code, errors } = transformSync(fileName, prepared, {
    jsx: { runtime: 'automatic', importSource: '@positronic/core' },
  });
  if (errors.length > 0) {
    throw new Error(formatErrors(fileName, errors));
  }
  return code;
}

// Find all .ts and .tsx files recursively, skipping _-prefixed entries
function findBrainFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('_')) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      results.push(fullPath);
    } else if (entry.isDirectory()) {
      results.push(...findBrainFiles(fullPath));
    }
  }
  return results;
}

for (const file of findBrainFiles(SRC_BRAINS)) {
  const source = await fs.readFile(file, 'utf8');
  const outFile = join(OUT_DIR, relative(SRC_BRAINS, file)).replace(
    /\.tsx?$/,
    '.js'
  );
  await fs.mkdir(dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, compile(file, source));
}
