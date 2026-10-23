/*
 * Dinero: SIEMPRE enteros en centavos de USD. Nunca floats guardados.
 * Estas funciones son puras (sin React ni Firestore) y son la ÚNICA forma de
 * formatear un monto para mostrar y de interpretar lo que escribe el usuario.
 */

/** Símbolo de la moneda del proyecto. */
export const SIMBOLO_USD = '$'

/**
 * Tope "sano" de una tarifa por hora (centavos): $1000. Lo usan la validación
 * de `setTarifasSede` y la de los montos de los perfiles/parámetros.
 */
export const LIMITE_TARIFA_CENTS = 100000

/**
 * Tope "sano" del monto de una clase (centavos): $10000. Más alto que el de una
 * tarifa porque una clase puede combinar varias personas/horas.
 */
export const LIMITE_MONTO_CENTS = 1000000

/** ¿Es un entero de centavos válido (>= 0 y dentro de un tope)? */
export function centsValidos(valor, maximo = LIMITE_MONTO_CENTS) {
  return Number.isInteger(valor) && valor >= 0 && valor <= maximo
}

/**
 * Centavos → "$45.00". Sin centavos negativos ni decimales raros: si el valor
 * no es un entero >= 0 devuelve '' (nunca "NaN" ni un símbolo suelto).
 */
export function formatearUSD(cents) {
  if (!Number.isInteger(cents) || cents < 0) return ''
  const enteros = Math.floor(cents / 100)
  const centavos = String(cents % 100).padStart(2, '0')
  return `${SIMBOLO_USD}${enteros}.${centavos}`
}

/**
 * Texto que escribe el usuario → centavos enteros, o `null` si no es un monto
 * válido. Acepta:
 *    "45"       → 4500
 *    "45.5"     → 4550
 *    "45,50"    → 4550
 *    "$45.00"   → 4500
 *    "1.234,56" → 123456   (punto de miles + coma decimal)
 *    "1,234.56" → 123456   (coma de miles + punto decimal)
 * Reglas: se quita el símbolo y los espacios. Con punto Y coma, el ÚLTIMO es el
 * separador decimal y el otro es de miles. Con un solo separador, se toma como
 * separador DECIMAL (así "45,50" y "45.5" dan 4550). Se redondea half-up a
 * centavos y nunca se aceptan negativos.
 */
export function parsearUSD(texto) {
  if (texto === null || texto === undefined) return null
  let limpio = String(texto).trim().replace(/[$\s]/g, '')
  if (!limpio) return null

  const tienePunto = limpio.includes('.')
  const tieneComa = limpio.includes(',')

  if (tienePunto && tieneComa) {
    const ultimoPunto = limpio.lastIndexOf('.')
    const ultimaComa = limpio.lastIndexOf(',')
    if (ultimaComa > ultimoPunto) {
      // Formato es-VE: "1.234,56" → separador de miles el punto.
      limpio = limpio.replace(/\./g, '').replace(',', '.')
    } else {
      // Formato en-US: "1,234.56" → separador de miles la coma.
      limpio = limpio.replace(/,/g, '')
    }
  } else if (tieneComa) {
    // Solo coma: separador decimal ("45,50").
    limpio = limpio.replace(',', '.')
  }

  if (!/^\d*\.?\d*$/.test(limpio) || !/\d/.test(limpio)) return null

  const valor = Number(limpio)
  if (!Number.isFinite(valor) || valor < 0) return null
  return Math.round(valor * 100)
}
