import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase/config'
import { actualizarProfesor, crearProfesor } from '../firebase/db'
import { CloseIcon } from './Icons'

/*
 * Alta/edición de una ficha de profesor. La tarifa por hora queda SIN DEFINIR:
 * este formulario no la captura ni la escribe. Soft delete con el toggle
 * "Activo".
 */
export default function FichaProfesorSheet({ tenantId, profesor = null, onClose, onSaved }) {
  const { user } = useAuth()
  const [nombre, setNombre] = useState(profesor?.nombre ?? '')
  const [telefono, setTelefono] = useState(profesor?.telefono ?? '')
  const [activo, setActivo] = useState(profesor?.activo !== false)
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function enviar(event) {
    event.preventDefault()
    setError('')
    setEnviando(true)
    try {
      const datos = { nombre, telefono: telefono || null, activo }
      const opciones = { uid: user?.uid ?? null }
      if (profesor) {
        await actualizarProfesor(db, tenantId, profesor.id, datos, opciones)
      } else {
        await crearProfesor(db, tenantId, datos, opciones)
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

      <form className="form" onSubmit={enviar}>
        <div className="form__field">
          <label className="form__label" htmlFor="fp-nombre">
            Nombre
          </label>
          <input
            className="form__input"
            id="fp-nombre"
            value={nombre}
            onChange={(event) => setNombre(event.target.value)}
            required
          />
        </div>

        <div className="form__field">
          <label className="form__label" htmlFor="fp-telefono">
            Teléfono (opcional)
          </label>
          <input
            className="form__input"
            id="fp-telefono"
            type="tel"
            value={telefono}
            onChange={(event) => setTelefono(event.target.value)}
          />
        </div>

        <label className="toggle">
          <input
            type="checkbox"
            checked={activo}
            onChange={(event) => setActivo(event.target.checked)}
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
