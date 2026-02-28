import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  server: {
    port: 7377,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('scheduler')) return 'vendor-react';
            if (id.includes('zod')) return 'vendor-zod';
            return 'vendor';
          }
          if (id.includes('/src/components/Chat/') || id.includes('/src/lib/ai')) {
            return 'ai-runtime';
          }
          if (id.includes('/src/stores/')) {
            return 'state';
          }
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
})
