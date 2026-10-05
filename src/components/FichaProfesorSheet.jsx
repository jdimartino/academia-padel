import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase/config'
import { FichaInvalidaError, actualizarProfesor, crearProfesor, getSedes } from '../firebase/db'
import { CloseIcon } from './Icons'

const DOCUMENTOS = [
  { valor: '', label: 'Sin documento' },
  { valor: 'cedula', label: 'Cédula' },
  { valor: 'pasaporte', label: 'Pasaporte' },
]

const LIMITES = { nombre: 200, email: 200, telefono: 30, documento: 30, notas: 1000 }

/** Orden de los campos para enfocar el primero inválido. */
const ORDEN_CAMPOS = ['nombre', 'apellidos', 'documentoTipo', 'telefono', 'email', 'notas']

function formDeProfesor(profesor) {
  return {
    nombre: profesor?.nombre ?? '',
    apellidos: profesor?.apellidos ?? '',
    telefono: profesor?.telefono ?? '',
    email: profesor?.email ?? '',
    documentoTipo: profesor?.documento?.tipo ?? '',
    documentoNumero: profesor?.documento?.numero ?? '',
    sedes: Array.isArray(profesor?.sedes) ? profesor.sedes : [],
    notas: profesor?.notas ?? '',
    activo: profesor?.activo !== false,
  }
}

/** Validación propia del formulario: no depende de la validación nativa. */
function validar(form) {
  const errores = {}
  const nombre = form.nombre.trim()
  const apellidos = form.apellidos.trim()

  if (!nombre) errores.nombre = 'Escribe el nombre'
  else if (nombre.length > LIMITES.nombre) {
    errores.nombre = `El nombre no puede superar ${LIMITES.nombre} caracteres`
  }
  if (!apellidos) errores.apellidos = 'Escribe los apellidos'
  else if (apellidos.length > LIMITES.nombre) {
    errores.apellidos = `Los apellidos no pueden superar ${LIMITES.nombre} caracteres`
  }

  const docTipo = form.documentoTipo
  const docNumero = form.documentoNumero.trim()
  if ((docTipo && !docNumero) || (!docTipo && docNumero)) {
    errores.documentoTipo = 'Completa el tipo y el numero del documento'
  } else if (docNumero.length > LIMITES.documento) {
    errores.documentoTipo = `El numero del documento no puede superar ${LIMITES.documento} caracteres`
  }

  if (form.telefono.trim().length > LIMITES.telefono) {
    errores.telefono = `El telefono no puede superar ${LIMITES.telefono} caracteres`
  }
  if (form.email.trim().length > LIMITES.email) {
    errores.email = `El email no puede superar ${LIMITES.email} caracteres`
  }
  if (form.notas.length > LIMITES.notas) {
    errores.notas = `Las notas no pueden superar ${LIMITES.notas} caracteres`
  }
  return errores
}

/*
 * Alta/edición de una ficha de profesor. La tarifa por hora queda SIN DEFINIR:
 * este formulario no la captura ni la escribe. `sedes` son las sedes donde
 * dicta (solo esas lo pueden asignar a una clase). Soft delete con el toggle
 * "Activo". Validación propia (noValidate) y foco al primer campo inválido.
 */
export default function FichaProfesorSheet({ tenantId, profesor = null, onClose, onSaved }) {
  const { user } = useAuth()
  const [form, setForm] = useState(() => formDeProfesor(profesor))
  const [sedes, setSedes] = useState([])
  const [errores, setErrores] = useState({})
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const campos = useRef({})

  useEffect(() => {
    let activo = true
    getSedes(db, tenantId)
      .then((lista) => {
        if (activo) setSedes(lista)
      })
      .catch(() => {
        if (activo) setSedes([])
      })
    return () => {
      activo = false
    }
  }, [tenantId])

  const set = (campo, valor) => {
    setForm((prev) => ({ ...prev, [campo]: valor }))
    setErrores((prev) => {
      const claves = campo === 'documentoNumero' ? [campo, 'documentoTipo'] : [campo]
      if (!claves.some((clave) => prev[clave])) return prev
      const siguiente = { ...prev }
      for (const clave of claves) siguiente[clave] = undefined
      return siguiente
    })
  }

  function alternarSede(sedeId) {
    setForm((prev) => ({
      ...prev,
      sedes: prev.sedes.includes(sedeId)
        ? prev.sedes.filter((id) => id !== sedeId)
        : [...prev.sedes, sedeId],
    }))
  }

  function primerInvalido(erroresNuevos) {
    const clave = ORDEN_CAMPOS.find((campo) => erroresNuevos[campo])
    if (clave) campos.current[clave]?.focus()
  }

  async function enviar(event) {
    event.preventDefault()
    setError('')
    const erroresNuevos = validar(form)
    setErrores(erroresNuevos)
    if (Object.keys(erroresNuevos).length > 0) {
      // No se toca la capa de datos mientras haya campos inválidos.
      primerInvalido(erroresNuevos)
      return
    }

    setEnviando(true)
    try {
      const datos = {
        nombre: form.nombre.trim(),
        apellidos: form.apellidos.trim(),
        telefono: form.telefono.trim() || null,
        email: form.email.trim() || null,
        documento:
          form.documentoTipo && form.documentoNumero.trim()
            ? { tipo: form.documentoTipo, numero: form.documentoNumero.trim() }
            : null,
        sedes: form.sedes,
        notas: form.notas,
        activo: form.activo,
      }
      const opciones = { uid: user?.uid ?? null }
      if (profesor) {
        await actualizarProfesor(db, tenantId, profesor.id, datos, opciones)
      } else {
        await crearProfesor(db, tenantId, datos, opciones)
      }
      onSaved?.()
    } catch (err) {
      setError(
        err instanceof FichaInvalidaError
          ? err.message
          : 'No se pudo guardar la ficha. Intenta de nuevo.',
      )
    } finally {
      setEnviando(false)
    }
  }

  const errorDe = (campo) => errores[campo]
  const propsError = (campo, id) => ({
    'aria-invalid': Boolean(errorDe(campo)),
    'aria-describedby': errorDe(campo) ? id : undefined,
  })
  const mensaje = (campo, id) =>
    errorDe(campo) ? (
      <p className="form__error" id={id} role="alert">
        {errorDe(campo)}
      </p>
    ) : null

  return (
    <aside
      className="sheet sheet--ficha glass-strong"
      role="dialog"
      aria-label={profesor ? 'Editar profesor' : 'Nuevo profesor'}
    >
      <header className="sheet__head">
        <div>
          <h2 className="sheet__titulo">{profesor ? 'Editar profesor' : 'Nuevo profesor'}</h2>
          <p className="sheet__subtitulo">Ficha del profesor</p>
        </div>
        <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose} autoFocus>
          <CloseIcon />
        </button>
      </header>

      {error ? (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      ) : null}

      <form className="form" onSubmit={enviar} noValidate>
        <div className="form__field">
          <label className="form__label" htmlFor="fp-nombre">
            Nombre
          </label>
          <input
            className="form__input"
            id="fp-nombre"
            value={form.nombre}
            onChange={(event) => set('nombre', event.target.value)}
            ref={(el) => {
              campos.current.nombre = el
            }}
            {...propsError('nombre', 'fp-nombre-error')}
          />
          {mensaje('nombre', 'fp-nombre-error')}
        </div>

        <div className="form__field">
          <label className="form__label" htmlFor="fp-apellidos">
            Apellidos
          </label>
          <input
            className="form__input"
            id="fp-apellidos"
            value={form.apellidos}
            onChange={(event) => set('apellidos', event.target.value)}
            ref={(el) => {
              campos.current.apellidos = el
            }}
            {...propsError('apellidos', 'fp-apellidos-error')}
          />
          {mensaje('apellidos', 'fp-apellidos-error')}
        </div>

        <div className="form__field">
          <label className="form__label" htmlFor="fp-telefono">
            Teléfono (opcional)
          </label>
          <input
            className="form__input"
            id="fp-telefono"
            type="tel"
            value={form.telefono}
            onChange={(event) => set('telefono', event.target.value)}
            ref={(el) => {
              campos.current.telefono = el
            }}
            {...propsError('telefono', 'fp-telefono-error')}
          />
          {mensaje('telefono', 'fp-telefono-error')}
        </div>

        <div className="form__field">
          <label className="form__label" htmlFor="fp-email">
            Email (opcional)
          </label>
          <input
            className="form__input"
            id="fp-email"
            type="email"
            value={form.email}
            onChange={(event) => set('email', event.target.value)}
            ref={(el) => {
              campos.current.email = el
            }}
            {...propsError('email', 'fp-email-error')}
          />
          {mensaje('email', 'fp-email-error')}
        </div>

        <div className="form__field">
          <label className="form__label" htmlFor="fp-documento-tipo">
            Documento (opcional)
          </label>
          <select
            className="form__input"
            id="fp-documento-tipo"
            value={form.documentoTipo}
            onChange={(event) => set('documentoTipo', event.target.value)}
            ref={(el) => {
              campos.current.documentoTipo = el
            }}
            {...propsError('documentoTipo', 'fp-documento-error')}
          >
            {DOCUMENTOS.map((opcion) => (
              <option key={opcion.valor} value={opcion.valor}>
                {opcion.label}
              </option>
            ))}
          </select>
          <input
            className="form__input"
            aria-label="Número de documento"
            placeholder="Número de documento"
            value={form.documentoNumero}
            onChange={(event) => set('documentoNumero', event.target.value)}
            {...propsError('documentoTipo', 'fp-documento-error')}
          />
          {mensaje('documentoTipo', 'fp-documento-error')}
        </div>

        <div className="form__field">
          <span className="form__label">Sedes donde dicta</span>
          {sedes.length === 0 ? (
            <p className="aviso">No hay sedes activas.</p>
          ) : (
            <ul className="sedes-check">
              {sedes.map((sede) => (
                <li key={sede.id}>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={form.sedes.includes(sede.id)}
                      onChange={() => alternarSede(sede.id)}
                    />
                    <span>{sede.nombre}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="form__field">
          <label className="form__label" htmlFor="fp-notas">
            Notas internas (opcional)
          </label>
          <textarea
            className="form__input"
            id="fp-notas"
            rows={3}
            value={form.notas}
            onChange={(event) => set('notas', event.target.value)}
            ref={(el) => {
              campos.current.notas = el
            }}
            {...propsError('notas', 'fp-notas-error')}
          />
          {mensaje('notas', 'fp-notas-error')}
        </div>

        <label className="toggle">
          <input
            type="checkbox"
            checked={form.activo}
            onChange={(event) => set('activo', event.target.checked)}
          />
          <span>Activo</span>
        </label>

        <button className="btn" type="submit" disabled={enviando}>
          {enviando ? 'Guardando…' : profesor ? 'Guardar cambios' : 'Crear profesor'}
        </button>
        <button type="button" className="btn btn--secondary" onClick={onClose}>
          Cancelar
        </button>
      </form>
    </aside>
  )
}
