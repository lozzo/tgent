import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const desktop = mode === 'desktop'

  return {
    plugins: [react()],
    define: {
      __TGENT_TARGET__: JSON.stringify(desktop ? 'desktop' : 'app'),
    },
    // Desktop uses the native Go engine and must not bundle the mobile WASM client.
    publicDir: desktop ? false : '../tgent-app/public',
    server: {
      proxy: {
        '/api': 'http://localhost:8080',
      },
    },
    build: {
      outDir: desktop
        ? '../tgent-desktop/frontend/dist'
        : '../tgent-app/dist',
      emptyOutDir: true,
      target: 'chrome61',
      cssTarget: 'chrome61',
      rolldownOptions: {
        output: {
          // WKWebView can load embedded chunks through the wails:// scheme.
          // The mobile build remains single-file for its older WebView targets.
          codeSplitting: desktop,
        },
      },
    },
  }
})
