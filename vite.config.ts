import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist/admin',
  },
  plugins: [react(), tailwindcss(), cloudflare()],
  resolve: {
    alias: { '@': `${import.meta.dirname}/src` },
  },
})
