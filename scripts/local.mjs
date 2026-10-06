/*
 * Arranque local en un solo comando: emuladores + seed + Vite.
 *
 * Los datos del emulador se persisten en ./.emulator-data (ignorado por git):
 * el primer arranque (o `npm run local -- --fresh`) borra esa carpeta, levanta
 * los emuladores SIN --import y corre el seed una vez. Los arranques siguientes
 * importan lo guardado.
 *
 * Cerrar con Ctrl+C es lo que guarda los datos: se apaga Vite, después se le
 * manda SIGINT a `firebase emulators:start` y SE ESPERA a que termine para que
 * complete el export. Nunca se usa SIGKILL.
 *
 * Requisitos: emuladores libres. Uso:  npm run local        /  npm run local -- --fresh
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = './.emulator-data'
const PROYECTO = 'academia-padel-jdm'
const PUERTOS = [
  { puerto: 8080, que: 'el emulador de Firestore' },
  { puerto: 9099, que: 'el emulador de Auth' },
  { puerto: 4000, que: 'la Emulator UI' },
  { puerto: 5173, que: 'el servidor de Vite' },
]
const ESPERA_MS = 60_000
const POLL_MS = 250
// Vite escucha solo en IPv6 en esta máquina: hay que mirar las dos familias.
const DIRECCIONES = ['127.0.0.1', '::1']

const fresco = process.argv.slice(2).includes('--fresh')

/** `true` si `direccion:puerto` acepta conexiones (algo está escuchando ahí). */
function puertoOcupadoEn(direccion, puerto) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: direccion, port: puerto })
    const listo = (valor) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(valor)
    }
    socket.once('connect', () => listo(true))
    socket.once('error', () => listo(false))
    socket.setTimeout(1500, () => listo(true))
  })
}

/**
 * Devuelve las direcciones ocupadas de la lista. Un puerto cuenta como ocupado
 * si CUALQUIERA de las dos familias acepta conexiones (Vite es IPv6-only acá).
 */
async function direccionesOcupadas(puerto) {
  const resultados = await Promise.all(DIRECCIONES.map((dir) => puertoOcupadoEn(dir, puerto)))
  return DIRECCIONES.filter((_, i) => resultados[i])
}

/**
 * Espera a que el puerto acepte conexiones en CUALQUIERA de las dos familias.
 * Rechaza si vence el timeout. `senal.cancelado` corta el polling cuando los
 * emuladores ya murieron.
 */
function esperarPuerto(puerto, que, timeoutMs, senal = {}) {
  return new Promise((resolve, reject) => {
    const limite = Date.now() + timeoutMs
    const intentar = async () => {
      if (senal.cancelado) return
      if ((await direccionesOcupadas(puerto)).length) {
        resolve()
        return
      }
      if (senal.cancelado) return
      if (Date.now() >= limite) {
        reject(new Error(`Timeout esperando a ${que} (puerto ${puerto}) después de ${timeoutMs / 1000}s`))
        return
      }
      setTimeout(intentar, POLL_MS)
    }
    intentar()
  })
}

/** Últimas líneas relevantes de stderr, para reportar un fallo de arranque. */
function recolectorError() {
  const lineas = []
  return {
    push: (texto) => {
      for (const linea of texto.split('\n')) {
        if (linea.includes('debug.log') || linea.includes('To suppress logging')) continue
        if (linea.trim()) lineas.push(linea.trim())
        if (lineas.length > 25) lineas.shift()
      }
    },
    texto: () => lineas.join('\n'),
  }
}

async function principal() {
  // 1. Puertos ocupados: se detecta ANTES de tocar nada. Cuenta como ocupado si
  //    responde en IPv4 o en IPv6.
  const ocupados = []
  for (const { puerto, que } of PUERTOS) {
    const direcciones = await direccionesOcupadas(puerto)
    if (direcciones.length) {
      ocupados.push(`  · ${que}: puerto ${puerto} ocupado en ${direcciones.join(' y ')}`)
    }
  }
  if (ocupados.length) {
    console.error('Puertos ocupados:')
    for (const linea of ocupados) console.error(linea)
    console.error('Cierra el emulador o el servidor que ya está corriendo y vuelve a probar.')
    return 1
  }

  // 2. Primer arranque, o --fresh: se descarta lo guardado.
  const hayDatos = existsSync(path.resolve(RAIZ, DATA))
  const sembrar = fresco || !hayDatos
  if (sembrar) {
    if (hayDatos) await rm(path.resolve(RAIZ, DATA), { recursive: true, force: true })
    console.log(hayDatos ? 'Datos borrados: arranque limpio.' : 'Primer arranque: arranque limpio.')
  }

  let vite = null
  let emuladores = null
  let seed = null
  let saliendo = false
  // Código de salida de los emuladores, o null si siguen vivos.
  let codigoEmuladores = null
  // Seed fallido: al cerrar hay que borrar .emulator-data en vez de conservarlo.
  let descartar = false
  let descartado = false
  // El usuario apretó Ctrl+C: no hay que reportar el seed como fallo.
  let interrumpido = false

  /** Borra .emulator-data una sola vez (seed a medias: no se conserva nada). */
  async function descartarDatos() {
    if (descartado) return
    descartado = true
    await rm(path.resolve(RAIZ, DATA), { recursive: true, force: true })
    console.log(`Datos descartados: ${DATA} borrado`)
  }

  /** Orden de cierre: Vite, después los emuladores, y se ESPERA el export. */
  async function bajar() {
    if (saliendo) return
    saliendo = true
    if (seed && seed.exitCode === null) seed.kill('SIGINT')
    if (vite && vite.exitCode === null) {
      vite.kill('SIGINT')
      vite = null
    }
    if (emuladores && emuladores.exitCode === null) {
      emuladores.kill('SIGINT')
      await new Promise((resolve) => emuladores.once('exit', resolve))
    }
    if (descartar) {
      // Seed a medias: el export ya terminó, así que se borra lo exportado y
      // NADA de esto se conserva ni se importa en el próximo arranque.
      await descartarDatos()
      return
    }
    console.log(`\nDatos guardados en ${DATA}`)
  }

  // 3. Emuladores (auth + firestore + ui; Storage y Functions apagados).
  const args = [
    'emulators:start',
    '--project',
    PROYECTO,
    '--only',
    'auth,firestore,ui',
    `--export-on-exit=${DATA}`,
  ]
  if (!sembrar) args.push(`--import=${DATA}`)

  console.log(
    sembrar
      ? 'Arrancando emuladores (sin importar datos guardados)…'
      : `Arrancando emuladores (importando ${DATA})…`,
  )

  const errores = recolectorError()
  const senal = { cancelado: false }
  emuladores = spawn('firebase', args, { cwd: RAIZ, stdio: ['ignore', 'inherit', 'pipe'] })
  emuladores.stderr.on('data', (dato) => {
    const texto = String(dato)
    process.stderr.write(texto)
    errores.push(texto)
  })
  emuladores.on('error', (error) => {
    errores.push(error.code === 'ENOENT' ? 'No se encontró el CLI de Firebase (firebase)' : String(error.message))
    senal.cancelado = true
  })

  const fallo = new Promise((resolve) => {
    emuladores.once('exit', (codigo) => {
      codigoEmuladores = codigo === null ? 1 : codigo
      senal.cancelado = true
      if (saliendo) return resolve(null)
      saliendo = true
      resolve(codigoEmuladores)
    })
  })
  // Si nadie espera `fallo` (p. ej. ya arrancaron los emuladores), no debe
  // tirar un rechazo sin manejar.
  fallo.catch(() => {})

  // 4. Se espera a que Firestore (8080) y Auth (9099) acepten conexiones.
  try {
    await Promise.race([
      Promise.all([
        esperarPuerto(8080, 'el emulador de Firestore', ESPERA_MS, senal),
        esperarPuerto(9099, 'el emulador de Auth', ESPERA_MS, senal),
      ]),
      fallo.then((codigo) => {
        if (codigo !== null) throw new Error(`emuladores:start terminó con código ${codigo}`)
      }),
    ])
  } catch (error) {
    const detalle = errores.texto()
    if (codigoEmuladores === null) {
      emuladores.kill('SIGINT')
      await new Promise((resolve) => emuladores.once('exit', resolve))
    }
    console.error(`Los emuladores no arrancaron: ${error.message}`)
    if (detalle) console.error(detalle)
    return 1
  }
  console.log('Emuladores listos: Firestore 8080 · Auth 9099 · UI http://127.0.0.1:4000')

  // Si los emuladores mueren ya arrancados, se baja Vite y se sale con error.
  fallo.then(async (codigo) => {
    if (codigo === null || codigo === 0) return
    interrumpido = true
    const detalle = errores.texto()
    console.error(`Los emuladores se apagaron (código ${codigo}).`)
    if (detalle) console.error(detalle)
    await bajar()
    process.exitCode = 1
  })

  // 5. Seed, una sola vez (primer arranque o --fresh).
  if (sembrar) {
    console.log('Corriendo el seed…')
    const codigoSeed = await new Promise((resolve) => {
      seed = spawn('npm', ['run', 'seed'], { cwd: RAIZ, stdio: 'inherit' })
      seed.on('error', () => resolve(1))
      seed.once('exit', (codigo) => resolve(codigo ?? 1))
    })
    seed = null
    if (codigoSeed !== 0) {
      // Se apagan los emuladores en orden y, al final del cierre, se borra
      // .emulator-data: un seed a medias no debe quedar guardado.
      descartar = true
      await bajar()
      await descartarDatos()
      if (!interrumpido) {
        console.error('El seed falló; se descartaron los datos. Vuelve a correr npm run local.')
        console.error(`(detalle: el seed salió con código ${codigoSeed})`)
      }
      return 1
    }
    console.log('Seed corrido.')
  }

  // 6. Vite, con los emuladores ya listos.
  vite = spawn('npm', ['run', 'dev'], { cwd: RAIZ, stdio: 'inherit' })
  vite.on('error', (error) => console.error('Vite no arrancó:', error.message))
  vite.once('exit', (codigo, motivo) => {
    if (saliendo) return
    vite = null
    console.log(`Vite terminó (${motivo ?? codigo}). Bajando los emuladores…`)
    bajar().then(() => {
      process.exitCode = codigo ?? 0
    })
  })
  console.log('URL: http://localhost:5173/login')
  console.log('Ctrl+C guarda los datos y apaga todo.')

  // 7. Ctrl+C: se baja todo en orden y se espera el export.
  for (const nombre of ['SIGINT', 'SIGTERM']) {
    process.on(nombre, () => {
      if (saliendo) return
      interrumpido = true
      console.log('\nCerrando…')
      bajar().then(() => {
        process.exitCode = 0
      })
    })
  }
}

try {
  process.exitCode = await principal()
} catch (error) {
  console.error('Error:', error.message)
  process.exitCode = 1
}
