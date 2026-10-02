import { BrowserRouter, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import { AuthProvider } from './context/AuthContext'
import Agenda from './pages/Agenda'
import Alumnos from './pages/Alumnos'
import Home from './pages/Home'
import Login from './pages/Login'
import Profesores from './pages/Profesores'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
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
            path="/"
            element={
              <ProtectedRoute>
                <Home />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
