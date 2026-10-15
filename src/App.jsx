import { BrowserRouter, Route, Routes } from 'react-router-dom'
import GuardRol from './components/GuardRol'
import ProtectedRoute from './components/ProtectedRoute'
import { AuthProvider } from './context/AuthContext'
import { AvisosProvider } from './context/AvisosContext'
import { TasasProvider } from './context/TasasContext'
import Agenda from './pages/Agenda'
import Alumnos from './pages/Alumnos'
import AsistenciaProfesor from './pages/AsistenciaProfesor'
import Cobros from './pages/Cobros'
import Configuracion from './pages/Configuracion'
import Home from './pages/Home'
import Login from './pages/Login'
import Profesores from './pages/Profesores'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
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
      </AuthProvider>
    </BrowserRouter>
  )
}
