import { getApp, getApps, initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig)

export default app

export const auth = getAuth(app)

// Solo la base (default). Nunca crear ni usar una base con nombre.
export const db = getFirestore(app)

/**
 * El Emulator Suite solo se conecta en desarrollo (VITE_USE_EMULATORS=true). En
 * producción esta rama no corre y se usa el proyecto real. Se expone como
 * función porque la creación de cuentas de profesor (Fase 7) usa una instancia
 * de Auth SECUNDARIA que también tiene que hablar con el emulador.
 */
export function conectarEmuladorAuth(instanciaAuth) {
  if (import.meta.env.VITE_USE_EMULATORS !== 'true') return
  const host = import.meta.env.VITE_EMULATOR_HOST ?? '127.0.0.1'
  connectAuthEmulator(
    instanciaAuth,
    `http://${host}:${import.meta.env.VITE_AUTH_EMULATOR_PORT ?? 9099}`,
    { disableWarnings: true },
  )
}

if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  conectarEmuladorAuth(auth)
  connectFirestoreEmulator(
    db,
    import.meta.env.VITE_EMULATOR_HOST ?? '127.0.0.1',
    Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT ?? 8080),
  )
}
