/*
 * Creación de la cuenta de Auth de un usuario (profesor o administrador).
 *
 * El admin es quien crea la cuenta. Si usáramos la instancia de Auth principal,
 * `createUserWithEmailAndPassword` reemplazaría la sesión del admin por la del
 * usuario nuevo. Por eso se levanta una instancia de Firebase SECUNDARIA
 * (nombre único) con su propio Auth: se crea la cuenta ahí, se cierra esa
 * sesión y se borra la app secundaria. La sesión del admin nunca se toca.
 *
 * Nunca se registra ni se persiste la contraseña temporal: viaja una sola vez
 * del formulario a `createUserWithEmailAndPassword`.
 *
 * Esta función se inyecta en `crearAccesoProfesor` (db.js) para que los tests
 * puedan reemplazarla por un doble sin tocar Auth.
 */

import { deleteApp, initializeApp } from 'firebase/app'
import { createUserWithEmailAndPassword, getAuth, signOut } from 'firebase/auth'
import { conectarEmuladorAuth, firebaseConfig } from './config'

let contador = 0

/**
 * Crea una cuenta de Auth con email/contraseña en una app secundaria y devuelve
 * su uid. La cuenta queda creada; la sesión secundaria se cierra y la app se
 * destruye siempre (incluso si algo falla). La contraseña NO se loguea.
 *
 * Es genérica: se reusa tanto para el acceso de un profesor como para el de un
 * administrador.
 */
export async function crearCuentaAuth({ email, password }) {
  contador += 1
  const nombre = `acceso-${Date.now()}-${contador}`
  const appSecundaria = initializeApp(firebaseConfig, nombre)
  const authSecundaria = getAuth(appSecundaria)
  conectarEmuladorAuth(authSecundaria)
  try {
    const credencial = await createUserWithEmailAndPassword(authSecundaria, email, password)
    return { uid: credencial.user.uid }
  } finally {
    try {
      await signOut(authSecundaria)
    } catch {
      // La sesión secundaria puede no haberse establecido: no es un error.
    }
    await deleteApp(appSecundaria)
  }
}

/** Alias histórico: la creación de la cuenta de un profesor es la misma genérica. */
export const crearCuentaAuthProfesor = crearCuentaAuth

export default crearCuentaAuth
