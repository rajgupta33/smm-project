import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: path.resolve(__dirname, '../'), // Absolute path to project root
    emptyOutDir: false,
    assetsDir: 'assets'
  }
})
