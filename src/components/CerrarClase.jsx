import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase/config'
import { cerrarClase, getCreditoAlumno } from '../firebase/db'
import { PARAMETROS_DEFAULT, calcularCierre, previsualizarCreditoAlumno } from '../lib/cobros'
import { estadoCierreAEstadoProfesor } from '../lib/profesores'
import { aMinutos, formatHora12 } from '../lib/agenda'
import { formatearUSD, parsearUSD } from '../lib/dinero'
import { formatearFechaLarga } from '../lib/fechas'
import BotonAccion from './BotonAccion'

const ESTADOS = [
  { valor: 'presente', label: 'Presente' },
  { valor: 'ausente_avisada', label: 'Avisó' },
  { valor: 'ausente_sin_aviso', label: 'Faltó sin aviso' },
]

const MOTIVOS = [
  { valor: 'descuento', label: 'Descuento' },
  { valor: 'acuerdo', label: 'Acuerdo' },
  { valor: 'otro', label: 'Otro' },
]

/** Minutos de la clase; 0 si las horas no se pueden leer. */
function duracionDe(clase) {
  try {
    const fin = aMinutos(clase.horaFin)
    const inicio = aMinutos(clase.horaInicio)
    return fin > inicio ? fin - inicio : 0
  } catch {
    return 0
  }
}

/** "1 h 30 min" | "1 h" | "30 min" para el preview de crédito. */
function horasTexto(minutos) {
  const h = Math.floor(minutos / 60)
  const min = minutos % 60
  if (h && min) return `${h} h ${min} min`
  if (h) return `${h} h`
  return `${min} min`
}

/**
 * Estado de asistencia inicial por alumno. Si la clase ya tiene la asistencia
 * cargada por su profesor (`asistenciaProfesor`), se precarga mapeando su enum
 * al del cierre; un valor desconocido se ignora y cae en el default. Todo lo
 * demás presente salvo lo ya guardado en `asistencias`.
 */
function inicial(clase) {
  const guardadas = clase.asistencias ?? []
  const delProfesor = clase.asistenciaProfesor?.porAlumno ?? null
  return Object.fromEntries(
    (clase.alumnos ?? []).map((id) => {
      const previa = guardadas.find((a) => a.alumnoId === id)
      if (previa) return [id, previa.estado]
      const equivalencia = delProfesor ? estadoCierreAEstadoProfesor(delProfesor[id]) : null
      return [id, equivalencia ?? 'presente']
    }),
  )
}

/**
 * Cierre de una clase (Phase 4): se marca la asistencia, se decide si se
 * factura, se confirma el monto (obligatorio si la clase no tenía precio) y se
 * ve, EN VIVO, cada cargo del alumno y el pago al profesor. El botón primario
 * (lime) confirma; la generación real la hace `cerrarClase` en una transacción.
 */
export default function CerrarClase({ clase, parametros, tenantId, sedeNombre, canchaNombre, onCerrado }) {
  const { user } = useAuth()

  const alumnos = useMemo(
    () =>
      (clase.alumnos ?? []).map((id, i) => ({
        id,
        nombre: (clase.alumnoNombres ?? [])[i] ?? 'Alumno',
      })),
    [clase],
  )

  const [asistencias, setAsistencias] = useState(() => inicial(clase))
  const [seFactura, setSeFactura] = useState(true)
  const inicialTexto = clase.cobro ? formatearUSD(clase.cobro.montoCents) : ''
  const [montoTexto, setMontoTexto] = useState(inicialTexto)
  const [motivoAjuste, setMotivoAjuste] = useState(clase.cobro?.motivoAjuste ?? 'otro')
  const [confirmando, setConfirmando] = useState(false)
  const [minutosCredito, setMinutosCredito] = useState({})

  // Crédito disponible de cada alumno (solo lectura, para el preview).
  const alumnosClave = (clase.alumnos ?? []).join(',')
  useEffect(() => {
    let activo = true
    Promise.all(
      (clase.alumnos ?? []).map((id) =>
        getCreditoAlumno(db, tenantId, id)
          .then((credito) => [id, credito.minutosDisponibles])
          .catch(() => [id, 0]),
      ),
    ).then((pares) => {
      if (activo) setMinutosCredito(Object.fromEntries(pares))
    })
    return () => {
      activo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, alumnosClave])

  const params = parametros ?? PARAMETROS_DEFAULT

  const editado = montoTexto.trim() !== inicialTexto
  const requiereMonto = seFactura && !clase.cobro
  const montoCents = parsearUSD(montoTexto)

  const registros = alumnos.map((alumno) => ({
    alumnoId: alumno.id,
    estado: asistencias[alumno.id] ?? 'presente',
  }))

  // Descripción en lenguaje humano de lo que se está por cerrar: duración,
  // profesor y desglose de la asistencia marcada.
  const presentes = registros.filter((r) => r.estado === 'presente').length
  const avisaron = registros.filter((r) => r.estado === 'ausente_avisada').length
  const faltaron = registros.filter((r) => r.estado === 'ausente_sin_aviso').length
  const partesAsistencia = [
    `${presentes} ${presentes === 1 ? 'presente' : 'presentes'}`,
    avisaron ? `${avisaron} que ${avisaron === 1 ? 'avisó' : 'avisaron'}` : null,
    faltaron ? `${faltaron} sin aviso` : null,
  ].filter(Boolean)
  const descripcion = `Clase de ${horasTexto(duracionDe(clase))}${
    clase.profesorNombre ? ` con ${clase.profesorNombre}` : ''
  } y ${registros.length} ${registros.length === 1 ? 'alumno' : 'alumnos'}: ${partesAsistencia.join(', ')}.`

  // Preview: mismo cálculo puro que usa el cierre real.
  const preview = useMemo(() => {
    let cobro = clase.cobro ?? null
    if (editado || requiereMonto) {
      cobro = {
        perfilCobroId: clase.cobro?.perfilCobroId ?? null,
        modo: clase.cobro?.modo ?? 'total',
        tarifaHoraCents: clase.cobro?.tarifaHoraCents ?? null,
        montoEstandarCents: clase.cobro?.montoEstandarCents ?? null,
        montoCents: montoCents ?? 0,
        ajustado: true,
        motivoAjuste,
      }
    }
    return calcularCierre({
      cobro,
      duracionMin: duracionDe(clase),
      asistencias: registros,
      parametros: params,
      seFactura,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clase, parametros, asistencias, seFactura, montoTexto, motivoAjuste])

  const cargosPorAlumno = Object.fromEntries(preview.cargos.map((c) => [c.alumnoId, c]))

  function marcar(alumnoId, estado) {
    setAsistencias((prev) => ({ ...prev, [alumnoId]: estado }))
  }

  // Falta el monto obligatorio: se avisa en línea y se bloquea la confirmación.
  const faltaMonto = requiereMonto && montoCents === null

  async function cerrar() {
    const datos = { asistencias: registros, seFactura }
    if (editado || requiereMonto) {
      datos.montoCents = montoCents ?? 0
      datos.motivoAjuste = motivoAjuste
    }
    // Deja el sello de quién confirmó la asistencia desde el móvil, si la
    // clase la cargó su profesor.
    if (clase.asistenciaProfesor) datos.confirmadoPorProfesorId = clase.profesorId
    await cerrarClase(db, tenantId, clase.id, datos, { uid: user?.uid ?? null })
    onCerrado?.()
  }

  return (
    <div className="cierre">
      <h3 className="sheet__subtitulo">Cerrar clase</h3>

      {clase.asistenciaProfesor ? (
        <p className="cierre__confirmado" role="status">
          Confirmado por profesor {clase.profesorNombre ?? 'Profesor'}
        </p>
      ) : null}

      <dl className="cierre__resumen">
        <div className="cierre__resumen-fila">
          <dt>Fecha</dt>
          <dd>{formatearFechaLarga(clase.fecha)}</dd>
        </div>
        <div className="cierre__resumen-fila">
          <dt>Horario</dt>
          <dd>
            {formatHora12(clase.horaInicio)} - {formatHora12(clase.horaFin)}
          </dd>
        </div>
        <div className="cierre__resumen-fila">
          <dt>Sede</dt>
          <dd>{clase.sedeNombre ?? sedeNombre ?? 'Sede'}</dd>
        </div>
        <div className="cierre__resumen-fila">
          <dt>Cancha</dt>
          <dd>{clase.canchaNombre ?? canchaNombre ?? 'Cancha'}</dd>
        </div>
        <div className="cierre__resumen-fila">
          <dt>Profesor</dt>
          <dd>{clase.profesorNombre ?? 'Profesor'}</dd>
        </div>
        <div className="cierre__resumen-fila">
          <dt>Alumnos</dt>
          <dd>{alumnos.length ? alumnos.map((a) => a.nombre).join(', ') : 'Sin alumnos'}</dd>
        </div>
      </dl>

      <p className="cierre__descripcion">{descripcion}</p>

      <ul className="asistencia-lista">
        {alumnos.map((alumno) => {
          const cargo = cargosPorAlumno[alumno.id]
          const estado = asistencias[alumno.id] ?? 'presente'
          const disponible = minutosCredito[alumno.id] ?? 0
          const creditoPreview = seFactura
            ? previsualizarCreditoAlumno({
                estado,
                minutosClase: duracionDe(clase),
                minutosDisponibles: disponible,
                porcentajeFaltaSinAviso: params.porcentajeFaltaSinAviso,
                faltaSinAvisoConCredito: params.faltaSinAvisoConCredito,
              })
            : null
          let notaCredito = null
          if (creditoPreview?.usaCredito) {
            notaCredito = `Usa ${horasTexto(creditoPreview.minutos)} de crédito · quedan ${horasTexto(
              Math.max(0, disponible - creditoPreview.minutos),
            )}`
          } else if (creditoPreview?.insuficiente && cargo) {
            notaCredito = `Crédito insuficiente: se cobrará ${formatearUSD(cargo.montoCents)}`
          }
          return (
            <li key={alumno.id} className="asistencia-fila">
              <span className="asistencia-nombre">
                {alumno.nombre}
                {seFactura ? (
                  <span className="cierre__monto">
                    {cargo ? formatearUSD(cargo.montoCents) : 'sin cargo'}
                  </span>
                ) : null}
                {notaCredito ? <span className="cierre__credito">{notaCredito}</span> : null}
              </span>
              <div className="seg" role="group" aria-label={`Asistencia de ${alumno.nombre}`}>
                {ESTADOS.map((opcion) => (
                  <button
                    key={opcion.valor}
                    type="button"
                    className={`seg__op${asistencias[alumno.id] === opcion.valor ? ' is-sel' : ''}`}
                    aria-pressed={asistencias[alumno.id] === opcion.valor}
                    onClick={() => marcar(alumno.id, opcion.valor)}
                  >
                    {opcion.label}
                  </button>
                ))}
              </div>
            </li>
          )
        })}
      </ul>

      <label className="parametros__check">
        <input type="checkbox" checked={seFactura} onChange={(e) => setSeFactura(e.target.checked)} />
        <span>¿Se factura?</span>
      </label>
      <span className="parametros__hint">Apágalo por fuerza mayor (lluvia, luz).</span>

      {seFactura ? (
        <div className="cierre__monto-caja">
          <label className="parametros__campo">
            <span className="form__label">Monto de la clase (USD)</span>
            <input
              className="form__input"
              type="text"
              inputMode="decimal"
              value={montoTexto}
              placeholder={requiereMonto ? 'Obligatorio' : ''}
              onChange={(e) => setMontoTexto(e.target.value)}
            />
          </label>
          {editado || requiereMonto ? (
            <label className="parametros__campo">
              <span className="form__label">Motivo</span>
              <select
                className="form__input"
                value={motivoAjuste}
                onChange={(e) => setMotivoAjuste(e.target.value)}
              >
                {MOTIVOS.map((m) => (
                  <option key={m.valor} value={m.valor}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => {
              setMontoTexto('0')
              setMotivoAjuste('cortesia')
            }}
          >
            Cortesía
          </button>
        </div>
      ) : null}

      <div className="cierre__preview" role="status">
        <div className="cierre__fila">
          <span>Total a cobrar</span>
          <strong>{formatearUSD(preview.resumen.totalCargosCents)}</strong>
        </div>
        <div className="cierre__fila">
          <span>Pago al profesor</span>
          <strong>{formatearUSD(preview.pagoProfesor.montoCents)}</strong>
        </div>
      </div>

      {faltaMonto ? (
        <p className="form__error" role="alert">
          Carga un monto para la clase (o apaga "¿Se factura?")
        </p>
      ) : null}

      {confirmando ? (
        <div className="confirm-box">
          <p className="confirm-box__texto">
            ¿Cerrar la clase de {formatearFechaLarga(clase.fecha)} de {formatHora12(clase.horaInicio)} a{' '}
            {formatHora12(clase.horaFin)} en {clase.sedeNombre ?? sedeNombre ?? 'la sede'} (
            {clase.canchaNombre ?? canchaNombre ?? 'cancha'}) con {clase.profesorNombre ?? 'el profesor'} y{' '}
            {alumnos.length ? alumnos.map((a) => a.nombre).join(', ') : 'sin alumnos'}?
          </p>
          <BotonAccion
            onClick={cerrar}
            accion="cerrar-clase"
            exito="Clase cerrada"
            textoOcupado="Cerrando clase…"
            disabled={faltaMonto}
          >
            Sí, cerrar la clase
          </BotonAccion>
          <button type="button" className="btn btn--secondary" onClick={() => setConfirmando(false)}>
            No, volver
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn-cta"
          disabled={faltaMonto}
          onClick={() => setConfirmando(true)}
        >
          Cerrar clase
        </button>
      )}
    </div>
  )
}
