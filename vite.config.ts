import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const localApiTarget = process.env.SPX_LOCAL_API_TARGET || 'http://127.0.0.1:8788';
  const localApiProxy = {
    target: localApiTarget,
    changeOrigin: true,
  };
  const proxy = mode === 'spx-live'
    ? {
      '/api/spx-gex-heatmap': {
        target: 'https://sius-ai-workshop.pages.dev',
        changeOrigin: true,
        secure: true,
      },
      '/api': localApiProxy,
    }
    : { '/api': localApiProxy };

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy,
    },
  };
})
