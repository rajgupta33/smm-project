import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/frontend/',   // 👈 this matches your deployed path
  build: {
    outDir: 'dist',
  },
})
