import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // GitHub Pages serves the site under /<repo>/; the local build stays at /.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  server: { port: 5173, host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:8787' } },
  // The battle engine serialises references by class name ("[Pokemon:p1a]"): workers keep class names when minified.
  worker: { format: 'es', rolldownOptions: { output: { minify: { mangle: false, compress: { keepNames: { function: true, class: true } } } } } },
  optimizeDeps: { include: ['@smogon/calc', '@smogon/calc/dist/mechanics/util.js', '@pkmn/dex', '@pkmn/sets'] },
});
