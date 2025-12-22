import { defineConfig } from 'vite';
import { resolve } from 'path';
import { cpSync, existsSync, mkdirSync } from 'fs';

const rootDir = __dirname;
const srcDir = resolve(rootDir, 'src');

function ensureDir(path) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function copyDir(src, dest) {
  if (!existsSync(src)) return;
  ensureDir(dest);
  cpSync(src, dest, { recursive: true });
}

function copyFile(src, dest) {
  if (!existsSync(src)) return;
  ensureDir(resolve(dest, '..'));
  cpSync(src, dest);
}

function copyExtensionAssets() {
  return {
    name: 'copy-extension-assets',
    apply: 'build',
    closeBundle() {
      const outDir = resolve(rootDir, 'dist');
      copyFile(resolve(srcDir, 'manifest.json'), resolve(outDir, 'manifest.json'));
      copyDir(resolve(srcDir, 'icons'), resolve(outDir, 'icons'));
      copyDir(resolve(srcDir, 'samples'), resolve(outDir, 'samples'));
      copyFile(resolve(srcDir, 'styles', 'friction.css'), resolve(outDir, 'styles', 'friction.css'));
      copyFile(resolve(srcDir, 'entries', 'content', 'earlyApplyLoader.js'), resolve(outDir, 'entries', 'content', 'earlyApplyLoader.js'));
      copyFile(resolve(srcDir, 'entries', 'content', 'loader.js'), resolve(outDir, 'entries', 'content', 'loader.js'));
    },
  };
}

export default defineConfig({
  root: srcDir,
  publicDir: false,
  build: {
    outDir: resolve(rootDir, 'dist'),
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: {
      input: {
        'entries/background/index': resolve(srcDir, 'entries/background/index.js'),
        'entries/content/index': resolve(srcDir, 'entries/content/index.js'),
        'entries/content/earlyApply': resolve(srcDir, 'entries/content/earlyApply.js'),
        'pages/popup': resolve(srcDir, 'pages/popup.html'),
        'pages/dashboard': resolve(srcDir, 'pages/dashboard.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  plugins: [copyExtensionAssets()],
});
