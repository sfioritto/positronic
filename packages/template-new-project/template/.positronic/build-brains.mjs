/**
 * Pre-compiles .tsx brain files to .js, preserving JSX text whitespace.
 *
 * This runs before wrangler's internal bundler so that JSX text formatting
 * (newlines, indentation) is preserved exactly as written in the source.
 * Without this step, the JSX compiler collapses whitespace in text nodes.
 *
 * Run: node .positronic/build-brains.mjs
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
              text: `{\`${escaped}\`}`,
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

// Find all .tsx files in brains/
function findTsxFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.tsx')) {
      results.push(fullPath);
    } else if (entry.isDirectory()) {
      results.push(...findTsxFiles(fullPath));
    }
  }
  return results;
}

const tsxFiles = findTsxFiles('brains');

if (tsxFiles.length > 0) {
  await esbuild.build({
    entryPoints: tsxFiles,
    outdir: 'brains',
    format: 'esm',
    jsx: 'automatic',
    jsxImportSource: '@positronic/core',
    plugins: [jsxTextPlugin()],
    bundle: false,
    allowOverwrite: true,
  });
}
