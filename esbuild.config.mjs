import esbuild from 'esbuild';
import process from 'process';

const dev = process.argv[2] === 'dev';

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: [
    'obsidian',
    'electron',
    'crypto',
    '@codemirror/autocomplete',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
  ],
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  sourcemap: dev ? 'inline' : false,
  treeShaking: true,
  outfile: 'main.js',
});

if (dev) {
  await context.watch();
  console.log('Watching for changes...');
} else {
  await context.rebuild();
  await context.dispose();
}
