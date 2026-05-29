import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: '../public',
    emptyOutDir: false,
    rollupOptions: {
      input: 'index.html',
      output: {
        entryFileNames: 'assets/proxy-luna-app.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});