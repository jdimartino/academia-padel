import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@academia/core/src/index.css'
import { App } from '@academia/core'

// Branding de la academia demo. Son los mismos valores por defecto del núcleo,
// escritos aquí para que cada academia nueva los cambie en su propia carpeta.
const config = {
  academyName: 'Academia Pádel',
  tagline: 'Gestión de academias de pádel',
  logoUrl: null,
}

// Interruptores de funcionalidad de esta academia. Vacío = comportamiento actual.
const toggles = {}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App config={config} toggles={toggles} />
  </StrictMode>,
)
