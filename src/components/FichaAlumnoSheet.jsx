import { useState, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase/config'
import { actualizarAlumno, crearAlumno } from '../firebase/db'
import { CATEGORIAS, etiquetaCategoria } from '../lib/agenda'
import { CloseIcon } from './Icons'

const TIPOS = [
  { valor: 'adulto', label: 'Adulto' },
  { valor: 'menor', label: 'Menor' },
]

function formDeAlumno(alumno) {
  if (!alumno) {
    return {
      nombre: '',
      tipo: 'adulto',
      nivel: '',
      email: '',
      activo: true,
      tutor: { nombre: '', email: '', telefono: '' },
    }
  }
  return {
    nombre: alumno.nombre ?? '',
    tipo: alumno.tipo ?? 'adulto',
    nivel: alumno.nivel ?? '',
    email: alumno.email ?? '',
    activo: alumno.activo !== false,
    tutor: {
      nombre: alumno.tutor?.nombre ?? '',
      email: alumno.tutor?.email ?? '',
      telefono: alumno.tutor?.telefono ?? '',
    },
  }
}

/*
 * Alta/edición de una ficha de alumno en un sheet glass-strong. El toggle de
 * tipo muestra u oculta el bloque del tutor (menores). No hay borrado físico:
 * el toggle "Activo" apagado es el soft delete (activo:false).
 */
export default function FichaAlumnoSheet({ tenantId, alumno = null, onClose, onSaved }) {
  const { user } = useAuth()
  const [form, setForm] = useState(() => formDeAlumno(alumno))
  const [error, setError] = useState('')
  const [errorTutor, setErrorTutor] = useState('')
  const [enviando, setEnviando] = useState(false)
  const tutorNombreRef = useRef(null)

  const set = (campo, valor) => setForm((prev) => ({ ...prev, [campo]: valor }))
  const setTutor = (campo, valor) =>
    setForm((prev) => ({ ...prev, tutor: { ...prev.tutor, [campo]: valor } }))

  async function enviar(event) {
    event.preventDefault()
    setError('')
    setErrorTutor('')

    if (form.tipo === 'menor' && !form.tutor.nombre.trim()) {
      setErrorTutor('Escribe el nombre del tutor')
      tutorNombreRef.current?.focus()
      return
    }

    setEnviando(true)
    try {
      const datos = {
        nombre: form.nombre,
        tipo: form.tipo,
        nivel: form.nivel || null,
        email: form.email || null,
        avisosActivos: form.avisosActivos ?? alumno?.avisosActivos ?? true,
        activo: form.activo,
      }
      if (form.tipo === 'menor') {
        datos.tutor = {
          nombre: form.tutor.nombre.trim(),
          email: form.tutor.email || null,
          telefono: form.tutor.telefono || null,
        }
      }
      const opciones = { uid: user?.uid ?? null }
      if (alumno) {
        await actualizarAlumno(db, tenantId, alumno.id, datos, opciones)
      } else {
        await crearAlumno(db, tenantId, datos, opciones)
      }
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <aside
      className="sheet glass-strong"
      role="dialog"
      aria-label={alumno ? 'Editar alumno' : 'Nuevo alumno'}
    >
      <header className="sheet__head">
        <div>
          <h2 className="sheet__titulo">{alumno ? 'Editar alumno' : 'Nuevo alumno'}</h2>
          <p className="sheet__subtitulo">Datos de contacto: solo administración</p>
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

      <form className="form" onSubmit={enviar}>
        <div className="form__field">
          <label className="form__label" htmlFor="fa-nombre">
            Nombre
          </label>
          <input
            className="form__input"
            id="fa-nombre"
            value={form.nombre}
            onChange={(event) => set('nombre', event.target.value)}
            required
          />
        </div>

        <div className="form__field">
          <span className="form__label">Tipo</span>
          <div className="chips-row">
            {TIPOS.map((tipo) => (
              <button
                type="button"
                key={tipo.valor}
                className={`chip-cancha${form.tipo === tipo.valor ? ' is-sel' : ''}`}
                aria-pressed={form.tipo === tipo.valor}
                onClick={() => set('tipo', tipo.valor)}
              >
                {tipo.label}
              </button>
            ))}
          </div>
        </div>

        <div className="form__field">
          <label className="form__label" htmlFor="fa-nivel">
            Nivel (opcional)
          </label>
          <select
            className="form__input"
            id="fa-nivel"
            value={form.nivel}
            onChange={(event) => set('nivel', event.target.value)}
          >
            <option value="">Sin nivel</option>
            {CATEGORIAS.map((valor) => (
              <option key={valor} value={valor}>
                {etiquetaCategoria(valor)}
              </option>
            ))}
          </select>
        </div>

        <div className="form__field">
          <label className="form__label" htmlFor="fa-email">
            Email (opcional)
          </label>
          <input
            className="form__input"
            id="fa-email"
            type="email"
            value={form.email}
            onChange={(event) => set('email', event.target.value)}
          />
        </div>

        {form.tipo === 'menor' ? (
          <fieldset className="tutor-box">
            <legend className="form__label">Tutor (los avisos van al tutor)</legend>
            <div className="form__field">
              <label className="form__label" htmlFor="fa-tutor-nombre">
                Nombre del tutor
              </label>
              <input
                className="form__input"
                id="fa-tutor-nombre"
                value={form.tutor.nombre}
                onChange={(event) => {
                  setTutor('nombre', event.target.value)
                  if (errorTutor) setErrorTutor('')
                }}
                required
                aria-invalid={!!errorTutor}
                ref={tutorNombreRef}
              />
              {errorTutor ? (
                <p className="alert alert--error" role="alert">
                  {errorTutor}
                </p>
              ) : null}
            </div>
            <div className="form__field">
              <label className="form__label" htmlFor="fa-tutor-email">
                Email del tutor (opcional)
              </label>
              <input
                className="form__input"
                id="fa-tutor-email"
                type="email"
                value={form.tutor.email}
                onChange={(event) => setTutor('email', event.target.value)}
              />
            </div>
            <div className="form__field">
              <label className="form__label" htmlFor="fa-tutor-tel">
                Teléfono del tutor (opcional)
              </label>
              <input
                className="form__input"
                id="fa-tutor-tel"
                type="tel"
                value={form.tutor.telefono}
                onChange={(event) => setTutor('telefono', event.target.value)}
              />
            </div>
          </fieldset>
        ) : null}

        <label className="toggle">
          <input
            type="checkbox"
            checked={form.activo}
            onChange={(event) => set('activo', event.target.checked)}
          />
          <span>Activo</span>
        </label>

        <button className="btn" type="submit" disabled={enviando}>
          {enviando ? 'Guardando…' : alumno ? 'Guardar cambios' : 'Crear alumno'}
        </button>
        <button type="button" className="btn btn--secondary" onClick={onClose}>
          Cancelar
        </button>
      </form>
    </aside>
  )
}
