import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/bundle.ts'],
  bundle: true,
  external: ['react', 'react-dom'],
  format: 'iife',
  // Don't use globalName - we handle window assignment ourselves in bundle.ts
  outfile: 'dist/components.js',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  // Ignore tsconfig's jsx setting
  tsconfigRaw: {
    compilerOptions: {
      jsx: 'react',
    },
  },
});
