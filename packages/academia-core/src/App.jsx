import { BrowserRouter, Route, Routes } from 'react-router-dom'
import GuardAdmin from './components/GuardAdmin'
import GuardRol from './components/GuardRol'
import ProtectedRoute from './components/ProtectedRoute'
import { AcademyProvider } from './context/AcademyContext'
import { AuthProvider } from './context/AuthContext'
import { AvisosProvider } from './context/AvisosContext'
import { CargandoProvider } from './context/CargandoContext'
import { TasasProvider } from './context/TasasContext'
import Agenda from './pages/Agenda'
import Alumnos from './pages/Alumnos'
import AsistenciaProfesor from './pages/AsistenciaProfesor'
import Cobros from './pages/Cobros'
import Configuracion from './pages/Configuracion'
import Home from './pages/Home'
import Login from './pages/Login'
import Profesores from './pages/Profesores'
import Reportes from './pages/Reportes'

function AppRutas() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CargandoProvider>
          <AvisosProvider>
            <TasasProvider>
              <Routes>
              <Route path="/login" element={<Login />} />
              <Route
                path="/:academia/agenda"
                element={
                  <ProtectedRoute>
                    <Agenda />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/:academia/alumnos"
                element={
                  <ProtectedRoute>
                    <Alumnos />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/:academia/profesores"
                element={
                  <ProtectedRoute>
                    <Profesores />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/:academia/cobros"
                element={
                  <ProtectedRoute>
                    <Cobros />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/:academia/configuracion"
                element={
                  <ProtectedRoute>
                    <Configuracion />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/:academia/reportes"
                element={
                  <ProtectedRoute>
                    <GuardAdmin>
                      <Reportes />
                    </GuardAdmin>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/:academia/asistencia"
                element={
                  <ProtectedRoute>
                    <GuardRol rol="profesor">
                      <AsistenciaProfesor />
                    </GuardRol>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <Home />
                  </ProtectedRoute>
                }
              />
              </Routes>
            </TasasProvider>
          </AvisosProvider>
        </CargandoProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default function App({ config, toggles }) {
  return (
    <AcademyProvider config={config} toggles={toggles}>
      <AppRutas />
    </AcademyProvider>
  )
}
