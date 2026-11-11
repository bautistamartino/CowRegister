import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider } from './auth';
import { RutaPrivada, RutaPublica } from './componentes/Rutas';
import { Layout } from './componentes/Layout';
import { Login } from './paginas/Login';
import { Registro } from './paginas/Registro';
import { Inicio } from './paginas/Inicio';
import { Lotes } from './paginas/Lotes';
import { SemenToros } from './paginas/SemenToros';
import { Animales } from './paginas/Animales';
import { AnimalNuevo } from './paginas/AnimalNuevo';
import { AnimalFicha } from './paginas/AnimalFicha';
import { AnimalesPlanilla } from './paginas/AnimalesPlanilla';

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
            <Route path="semen" element={<SemenToros />} />
            <Route path="animales" element={<Animales />} />
            {/* "nuevo" va antes que ":id" (React Router igual prioriza la ruta fija). */}
            <Route path="animales/nuevo" element={<AnimalNuevo />} />
            <Route path="animales/planilla" element={<AnimalesPlanilla />} />
            <Route path="animales/:id" element={<AnimalFicha />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
