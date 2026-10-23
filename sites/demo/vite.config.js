import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const EXPECTED_PROJECT_ID = 'academia-padel-jdm'
const EXPECTED_TENANT_ID = 'demo'
const EMULATOR_MODE = 'emulator'
const SITE_DIR = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // Env is read for the build guard. No env value is ever printed.
  const env = loadEnv(mode, SITE_DIR, '')
  // Build safety net. Every `vite build` is checked:
  // - `--mode emulator` (local work, `npm run build` at the root) must point at the
  //   emulators; it reads .env.emulator, which overrides .env.local.
  // - any other mode is a production build (what jdm runs inside this folder) and is
  //   ALWAYS guarded: emulators off and the right project, tenant and API key.
  //   A .env.local left with VITE_USE_EMULATORS=true makes it fail instead of shipping
  //   a bundle wired to the emulators.
  if (command === 'build' && mode === EMULATOR_MODE) {
    if (env.VITE_USE_EMULATORS !== 'true') {
      throw new Error(
        `[build] --mode ${EMULATOR_MODE} requiere VITE_USE_EMULATORS=true (ver .env.emulator).`
      )
    }
  } else if (command === 'build') {
    if (env.VITE_USE_EMULATORS !== 'false') {
      throw new Error(
        '[build] Build de producción con VITE_USE_EMULATORS distinto de "false". ' +
        'Poné VITE_USE_EMULATORS=false en .env.production.local (o usá --mode emulator para un build local).'
      )
    }
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
