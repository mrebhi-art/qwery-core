import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5090,
    proxy: {
      '/dashboard/api': {
        target: 'http://localhost:4097',
        changeOrigin: true,
      },
      '/evaluation': {
        target: 'http://localhost:4097',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
  },
});
