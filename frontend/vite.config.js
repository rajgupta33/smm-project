import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist', // Keep it in dist - this is the standard and safe approach
    emptyOutDir: true,
    assetsDir: 'assets'
  }
})
