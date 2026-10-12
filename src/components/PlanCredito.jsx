import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useAvisos } from '../context/AvisosContext'
import { db } from '../firebase/config'
import {
  actualizarPlanAlumno,
  anularCredito,
  comprarCredito,
  crearPlanAlumno,
  desactivarPlanAlumno,
  getCreditoAlumno,
  getParametros,
  getPlanActivo,
  listarAlumnos,
  listarPlanesAlumno,
  sugerirDescuentoHermanos,
} from '../firebase/db'
import { FRECUENCIAS_PLAN, estadoLote, minutosDisponibles, precioMensualidad } from '../lib/cobros'
import { formatearUSD, parsearUSD } from '../lib/dinero'
import { formatearFechaCorta, hoyISO } from '../lib/fechas'
import { esErrorDeNegocio } from '../lib/avisos'

/** Opciones de horas incluidas: medias horas de 0.5 a 20 (múltiplos de 30 min). */
const HORAS_OPCIONES = Array.from({ length: 40 }, (_, i) => (i + 1) / 2)

const FRECUENCIAS_LABEL = { semanal: 'Semanal', mensual: 'Mensual' }

const ESTADO_LOTE_LABEL = {
  activo: 'Activo',
  agotado: 'Agotado',
  vencido: 'Vencido',
  anulado: 'Anulado',
  bloqueado: 'Sin pagar',
}

/** "8 h" | "1 h 30 min" | "30 min". */
function horasTexto(minutos) {
  const h = Math.floor(minutos / 60)
  const min = minutos % 60
  if (h && min) return `${h} h ${min} min`
  if (h) return `${h} h`
  return `${min} min`
}

function formDePlan(plan) {
  return {
    nombre: plan?.nombre ?? '',
    frecuencia: plan?.frecuencia ?? 'mensual',
    horas: plan ? String(plan.minutosIncluidos / 60) : '8',
    precioTexto: plan ? formatearUSD(plan.precioCents) : '',
    descuentoHermanos: plan?.descuentoHermanos ?? false,
    activo: plan?.activo !== false,
  }
}

/**
 * Sección "Plan y crédito" de la ficha de un alumno (Phase 5): resumen del plan
 * activo, horas disponibles, historial de lotes, alta/edición del plan y la
 * compra/renovación y anulación del crédito. Solo administración.
 */
export default function PlanCredito({ tenantId, alumno }) {
  const { user } = useAuth()
  const { mostrarExito, mostrarErrorTecnico, confirmar } = useAvisos()
  const uid = user?.uid ?? null

  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [editando, setEditando] = useState(null)
  const [version, setVersion] = useState(0)

  const esMenor = alumno.tipo === 'menor'
  const recargar = () => setVersion((v) => v + 1)

  useEffect(() => {
    let activo = true
    Promise.all([
      getParametros(db, tenantId),
      getPlanActivo(db, tenantId, alumno.id),
      listarPlanesAlumno(db, tenantId, alumno.id),
      getCreditoAlumno(db, tenantId, alumno.id, hoyISO()),
    ])
      .then(async ([parametros, plan, planes, credito]) => {
        let hermanos = false
        if (esMenor) {
          try {
            const { alumnos } = await listarAlumnos(db, tenantId, { estado: 'activos', limite: 100 })
            hermanos = sugerirDescuentoHermanos(alumno, alumnos)
          } catch {
            hermanos = false
          }
        }
        return { parametros, plan, planes, credito, hermanos }
      })
      .then((data) => {
        if (!activo) return
        setDatos(data)
        setError('')
      })
      .catch((err) => {
        if (!activo) return
        if (esErrorDeNegocio(err)) setError(err.message)
        else mostrarErrorTecnico('cargar-credito', err)
      })
    return () => {
      activo = false
    }
  }, [tenantId, alumno, esMenor, version, mostrarErrorTecnico])

  const resumen = useMemo(() => {
    if (!datos) return null
    const usados = (datos.credito.lotes ?? [])
      .filter((lote) => lote.estado !== 'anulado')
      .reduce((total, lote) => total + (lote.minutosUsados ?? 0), 0)
    const comprados = (datos.credito.lotes ?? [])
      .filter((lote) => lote.estado !== 'anulado')
      .reduce((total, lote) => total + (lote.minutosComprados ?? 0), 0)
    const proximo = (datos.credito.usables ?? [])
      .map((lote) => lote.venceEn)
      .filter(Boolean)
      .sort()[0] ?? null
    return { usados, comprados, proximo }
  }, [datos])

  function abrirNuevo() {
    setEditando(formDePlan(null))
  }

  function abrirEditar() {
    setEditando(formDePlan(datos.plan))
  }

  async function guardarPlan(event) {
    event.preventDefault()
    const minutos = Math.round(Number(editando.horas) * 60)
    const precioCents = parsearUSD(editando.precioTexto)
    if (precioCents === null || precioCents <= 0) {
      setError('Escribe un precio válido para el plan')
      return
    }
    setOcupado(true)
    setError('')
    try {
      const payload = {
        nombre: editando.nombre,
        frecuencia: editando.frecuencia,
        minutosIncluidos: minutos,
        precioCents,
        descuentoHermanos: editando.descuentoHermanos,
        activo: editando.activo,
      }
      if (datos.plan) await actualizarPlanAlumno(db, tenantId, datos.plan.id, payload, { uid })
      else await crearPlanAlumno(db, tenantId, { alumnoId: alumno.id, ...payload }, { uid })
      mostrarExito(datos.plan ? 'Plan actualizado' : 'Plan creado')
      setEditando(null)
      recargar()
    } catch (err) {
      if (esErrorDeNegocio(err)) setError(err.message)
      else mostrarErrorTecnico('guardar-plan', err)
    } finally {
      setOcupado(false)
    }
  }

  async function desactivar() {
    const confirmado = await confirmar({
      titulo: '¿Desactivar el plan?',
      mensaje: 'Dejará de estar activo. Los créditos ya comprados no cambian.',
      textoCancelar: 'Cancelar',
      textoConfirmar: 'Desactivar',
    })
    if (!confirmado) return
    setOcupado(true)
    try {
      await desactivarPlanAlumno(db, tenantId, datos.plan.id, { uid })
      mostrarExito('Plan desactivado')
      recargar()
    } catch (err) {
      mostrarErrorTecnico('desactivar-plan', err)
    } finally {
      setOcupado(false)
    }
  }

  async function comprar() {
    const monto = precioMensualidad(datos.plan, datos.parametros.descuentoHermanosPct)
    const confirmado = await confirmar({
      titulo: '¿Comprar crédito?',
      mensaje: `Se generará una mensualidad de ${formatearUSD(monto)} y un lote de ${horasTexto(
        datos.plan.minutosIncluidos,
      )}.`,
      textoCancelar: 'Cancelar',
      textoConfirmar: 'Comprar',
    })
    if (!confirmado) return
    setOcupado(true)
    try {
      await comprarCredito(db, tenantId, alumno.id)
      mostrarExito('Crédito comprado')
      recargar()
    } catch (err) {
      if (esErrorDeNegocio(err)) setError(err.message)
      else mostrarErrorTecnico('comprar-credito', err)
    } finally {
      setOcupado(false)
    }
  }

  async function anularLote(lote) {
    const confirmado = await confirmar({
      titulo: '¿Anular el crédito?',
      mensaje: 'El lote y su mensualidad quedan anulados. No se puede deshacer.',
      textoCancelar: 'Cancelar',
      textoConfirmar: 'Anular',
    })
    if (!confirmado) return
    setOcupado(true)
    try {
      await anularCredito(db, tenantId, lote.id)
      mostrarExito('Crédito anulado')
      recargar()
    } catch (err) {
      if (esErrorDeNegocio(err)) setError(err.message)
      else mostrarErrorTecnico('anular-credito', err)
    } finally {
      setOcupado(false)
    }
  }

  if (!datos) {
    return (
      <section className="plan-credito glass" aria-label="Plan y crédito">
        <h3 className="sheet__subtitulo">Plan y crédito</h3>
        <p className="parametros__hint">Cargando…</p>
      </section>
    )
  }

  const { plan, parametros, credito, hermanos } = datos
  const precioEfectivo = editando
    ? precioMensualidad(
        { precioCents: parsearUSD(editando.precioTexto) ?? 0, descuentoHermanos: editando.descuentoHermanos },
        parametros.descuentoHermanosPct,
      )
    : 0

  return (
    <section className="plan-credito glass" aria-label="Plan y crédito">
      <h3 className="sheet__subtitulo">Plan y crédito</h3>

      {error ? (
        <p className="form__error" role="alert">
          {error}
        </p>
      ) : null}

      {plan ? (
        <>
          <div className="plan-credito__resumen">
            <strong>{plan.nombre}</strong>
            <span className="parametros__hint">
              {FRECUENCIAS_LABEL[plan.frecuencia] ?? plan.frecuencia} · {horasTexto(plan.minutosIncluidos)} ·{' '}
              {formatearUSD(precioMensualidad(plan, parametros.descuentoHermanosPct))}
              {plan.descuentoHermanos ? ' (hermanos)' : ''}
            </span>
          </div>

          <div className="plan-credito__barra-caja">
            <div className="plan-credito__barra" role="img" aria-label="Horas usadas del crédito">
              <span
                className="plan-credito__relleno"
                style={{
                  width: `${
                    resumen.comprados > 0 ? Math.min(100, (resumen.usados / resumen.comprados) * 100) : 0
                  }%`,
                }}
              />
            </div>
            <span className="plan-credito__horas">
              {horasTexto(credito.minutosDisponibles)} disponibles
            </span>
          </div>

          <p className="parametros__hint">
            {resumen.proximo
              ? `Próximo vencimiento: ${formatearFechaCorta(resumen.proximo)}`
              : 'Sin vencimiento.'}
          </p>

          <div className="plan-credito__acciones">
            <button type="button" className="btn" disabled={ocupado} onClick={comprar}>
              Comprar / Renovar crédito
            </button>
            <button type="button" className="btn btn--secondary" disabled={ocupado} onClick={abrirEditar}>
              Editar plan
            </button>
            <button type="button" className="btn btn--secondary" disabled={ocupado} onClick={desactivar}>
              Desactivar
            </button>
          </div>
        </>
      ) : (
        <p className="parametros__hint">Sin plan activo.</p>
      )}

      {editando ? (
        <div className="plan-credito__form">
          <label className="parametros__campo">
            <span className="form__label">Nombre</span>
            <input
              className="form__input"
              value={editando.nombre}
              onChange={(e) => setEditando({ ...editando, nombre: e.target.value })}
            />
          </label>
          <label className="parametros__campo">
            <span className="form__label">Frecuencia</span>
            <select
              className="form__input"
              value={editando.frecuencia}
              onChange={(e) => setEditando({ ...editando, frecuencia: e.target.value })}
            >
              {FRECUENCIAS_PLAN.map((valor) => (
                <option key={valor} value={valor}>
                  {FRECUENCIAS_LABEL[valor] ?? valor}
                </option>
              ))}
            </select>
          </label>
          <label className="parametros__campo">
            <span className="form__label">Horas incluidas</span>
            <select
              className="form__input"
              value={editando.horas}
              onChange={(e) => setEditando({ ...editando, horas: e.target.value })}
            >
              {HORAS_OPCIONES.map((valor) => (
                <option key={valor} value={valor}>
                  {horasTexto(valor * 60)}
                </option>
              ))}
            </select>
          </label>
          <label className="parametros__campo">
            <span className="form__label">Precio (USD)</span>
            <input
              className="form__input"
              inputMode="decimal"
              value={editando.precioTexto}
              onChange={(e) => setEditando({ ...editando, precioTexto: e.target.value })}
            />
          </label>
          {esMenor ? (
            <label className="parametros__check">
              <input
                type="checkbox"
                checked={editando.descuentoHermanos}
                onChange={(e) => setEditando({ ...editando, descuentoHermanos: e.target.checked })}
              />
              <span>Descuento de hermanos</span>
            </label>
          ) : null}
          {esMenor && hermanos ? (
            <p className="parametros__hint">
              Hay otro menor a cargo del mismo representante: puedes aplicar el descuento.
            </p>
          ) : null}
          {editando.descuentoHermanos ? (
            <p className="parametros__hint">Precio final: {formatearUSD(precioEfectivo)}</p>
          ) : null}
          <div className="plan-credito__acciones">
            <button type="button" className="btn-cta" disabled={ocupado} onClick={guardarPlan}>
              {ocupado ? 'Guardando…' : 'Guardar plan'}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={ocupado}
              onClick={() => setEditando(null)}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn--secondary" onClick={abrirNuevo}>
          {plan ? 'Nuevo plan' : 'Crear plan'}
        </button>
      )}

      <ul className="plan-credito__lotes">
        {(credito.lotes ?? []).map((lote) => {
          const estado = estadoLote(lote, hoyISO(), {
            creditoRequierePago: credito.creditoRequierePago,
            cargoPagado: lote.cargoPagado,
          })
          const puedeAnular = (lote.minutosUsados ?? 0) === 0 && estado !== 'anulado'
          return (
            <li key={lote.id} className="plan-credito__lote">
              <span>
                {horasTexto(minutosDisponibles(lote))} de {horasTexto(lote.minutosComprados)}
                <span className={`badge badge--${estado}`}>{ESTADO_LOTE_LABEL[estado] ?? estado}</span>
              </span>
              <span className="plan-credito__lote-meta">
                {estado !== 'anulado' ? (lote.cargoPagado ? 'Mensualidad pagada' : 'Mensualidad pendiente') : ''}
              </span>
              {puedeAnular ? (
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={ocupado}
                  onClick={() => anularLote(lote)}
                >
                  Anular
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
