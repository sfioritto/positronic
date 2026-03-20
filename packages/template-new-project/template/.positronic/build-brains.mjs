/**
 * Pre-compiles brain files from src/brains/ to .positronic/brains/.
 *
 * For .tsx files, an esbuild plugin preserves JSX text whitespace by wrapping
 * JSXText nodes in expression containers before the JSX transform runs.
 * For .ts files, esbuild simply transpiles TypeScript to JavaScript.
 *
 * The compiled output lives in .positronic/brains/ and resolves its relative
 * imports (../brain.js, ../services/...) through symlinks that mirror src/.
 */
import * as esbuild from 'esbuild';
import ts from 'typescript';
import { readdirSync, promises as fs } from 'fs';
import { join } from 'path';

// Esbuild plugin that preserves whitespace in JSX text nodes.
// Uses TypeScript's parser to find JSXText nodes and wrap them in
// expression containers ({`text`}) before esbuild's JSX transform runs.
function jsxTextPlugin() {
  return {
    name: 'jsx-text-preserver',
    setup(build) {
      build.onLoad({ filter: /\.tsx$/ }, async (args) => {
        const source = await fs.readFile(args.path, 'utf8');
        const sourceFile = ts.createSourceFile(
          args.path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX
        );

        const replacements = [];
        function visit(node) {
          if (node.kind === ts.SyntaxKind.JsxText) {
            const rawText = node.getText(sourceFile);
            const escaped = rawText
              .replace(/\\/g, '\\\\')
              .replace(/`/g, '\\`')
              .replace(/\$/g, '\\$');
            replacements.push({
              start: node.getStart(sourceFile),
              end: node.getEnd(),
              text: `{\`<%= '${escaped}' %>\`}`,
            });
          }
          ts.forEachChild(node, visit);
        }
        visit(sourceFile);

        if (replacements.length === 0) return { contents: source, loader: 'tsx' };

        let result = source;
        for (const r of replacements.reverse()) {
          result = result.slice(0, r.start) + r.text + result.slice(r.end);
        }
        return { contents: result, loader: 'tsx' };
      });
    },
  };
}

// Find all .ts and .tsx files recursively
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
    if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      results.push(fullPath);
    } else if (entry.isDirectory()) {
      results.push(...findBrainFiles(fullPath));
    }
  }
  return results;
}

const brainFiles = findBrainFiles('../src/brains');

if (brainFiles.length > 0) {
  await esbuild.build({
    entryPoints: brainFiles,
    outdir: 'brains',
    format: 'esm',
    jsx: 'automatic',
    jsxImportSource: '@positronic/core',
    plugins: [jsxTextPlugin()],
    bundle: false,
    allowOverwrite: true,
  });
}
