import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const EXPECTED_PROJECT_ID = 'academia-padel-jdm'
const EXPECTED_TENANT_ID = 'demo'
const SITE_DIR = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // Env is read for the build guard. No env value is ever printed.
  const env = loadEnv(mode, SITE_DIR, '')
  // Build safety net: fail fast if a production build is missing or has the wrong
  // Firebase web config. Only on `vite build` and only when not using the emulators,
  // so `npm run dev` and the local emulator build keep working.
  if (command === 'build' && env.VITE_USE_EMULATORS !== 'true') {
    if (env.VITE_FIREBASE_PROJECT_ID !== EXPECTED_PROJECT_ID) {
      throw new Error(
        `[build] VITE_FIREBASE_PROJECT_ID inválido: debe ser "${EXPECTED_PROJECT_ID}". ` +
        'Copiá .env.example a .env.local y completá los valores.'
      )
    }
    if (env.VITE_TENANT_ID !== EXPECTED_TENANT_ID) {
      throw new Error(
        `[build] VITE_TENANT_ID inválido: debe ser "${EXPECTED_TENANT_ID}".`
      )
    }
    if (!env.VITE_FIREBASE_API_KEY) {
      throw new Error(
        '[build] VITE_FIREBASE_API_KEY vacío. Copiá .env.example a .env.local y completá los valores.'
      )
    }
  }

  return {
    root: SITE_DIR,
    envDir: SITE_DIR,
    plugins: [react()],
    resolve: {
      // Un solo React aunque el núcleo viva en otro paquete del workspace.
      dedupe: ['react', 'react-dom'],
    },
    server: {
      host: '127.0.0.1',
      strictPort: true,
      allowedHosts: ['.ts.net'],
    },
  }
})
