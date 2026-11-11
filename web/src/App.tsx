import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider } from './auth';
import { RutaPrivada, RutaPublica } from './componentes/Rutas';
import { Layout } from './componentes/Layout';
import { Login } from './paginas/Login';
import { Registro } from './paginas/Registro';
import { Inicio } from './paginas/Inicio';
import { Lotes } from './paginas/Lotes';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<RutaPublica><Login /></RutaPublica>} />
          <Route path="/registro" element={<RutaPublica><Registro /></RutaPublica>} />
          {/* Ruta "de layout": no tiene path propio. Exige sesión y dibuja el menú;
              las rutas hijas se muestran dentro del <Outlet /> del Layout. */}
          <Route element={<RutaPrivada><Layout /></RutaPrivada>}>
            <Route index element={<Inicio />} />
            <Route path="lotes" element={<Lotes />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
