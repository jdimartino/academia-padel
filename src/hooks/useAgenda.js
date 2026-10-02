import { useEffect, useState } from 'react'
import { db } from '../firebase/config'
import { getCanchas, getClasesDeSedePorFecha, getSedes } from '../firebase/db'
import { hoyISO } from '../lib/fechas'

/*
 * Carga la agenda de un tenant: sedes (con sus canchas) y las clases de la
 * sede/fecha seleccionadas. Todo acotado por tenant + sede + fecha.
 * Las sedes se leen una vez (al cambiar de tenant); las clases, cada vez que
 * cambia la sede o el día. El estado de "cargando" se deriva de si ya existe
 * la lectura para la clave actual, así el efecto no sincroniza estado.
 */
export default function useAgenda(tenantId) {
  const [fecha, setFecha] = useState(hoyISO())
  const [sedeId, setSedeId] = useState(null)
  const [sedes, setSedes] = useState(null)
  const [clasesPorClave, setClasesPorClave] = useState({ clave: null, lista: [] })
  const [error, setError] = useState('')

  useEffect(() => {
    let activo = true

    async function cargarSedes() {
      try {
        const lista = await getSedes(db, tenantId)
        const canchas = await Promise.all(lista.map((sede) => getCanchas(db, tenantId, sede.id)))
        if (!activo) return
        const conCanchas = lista.map((sede, i) => ({ ...sede, canchas: canchas[i] }))
        setSedes(conCanchas)
        setError('')
        setSedeId((prev) =>
          prev && conCanchas.some((s) => s.id === prev) ? prev : (conCanchas[0]?.id ?? null),
        )
      } catch (err) {
        if (activo) setError(err.message)
      }
    }

    cargarSedes()
    return () => {
      activo = false
    }
  }, [tenantId])

  const clave = sedeId ? `${sedeId}|${fecha}` : null

  useEffect(() => {
    if (!clave) return undefined
    let activo = true
    getClasesDeSedePorFecha(db, tenantId, sedeId, fecha)
      .then((lista) => {
        if (!activo) return
        setClasesPorClave({ clave, lista })
        setError('')
      })
      .catch((err) => {
        if (activo) setError(err.message)
      })
    return () => {
      activo = false
    }
  }, [tenantId, sedeId, fecha, clave])

  const clases = clasesPorClave.clave === clave ? clasesPorClave.lista : []
  const cargandoClases = clave !== null && clasesPorClave.clave !== clave && !error

  return {
    sedes,
    sedeId,
    setSedeId,
    fecha,
    setFecha,
    clases,
    cargando: sedes === null || cargandoClases,
    error,
  }
}
