import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider } from './sesion/auth';
import { RutaPrivada, RutaPublica } from './compartido/Rutas';
import { Layout } from './compartido/Layout';
import { Login } from './sesion/Login';
import { Registro } from './sesion/Registro';
import { Inicio } from './compartido/Inicio';
import { Lotes } from './lotes/Lotes';
import { SemenToros } from './reproduccion/SemenToros';
import { Animales } from './animales/Animales';
import { AnimalNuevo } from './animales/AnimalNuevo';
import { AnimalFicha } from './animales/AnimalFicha';
import { AnimalesPlanilla } from './animales/AnimalesPlanilla';
import { Bajas } from './bajas/Bajas';
import { BajaFicha } from './bajas/BajaFicha';
import { Informes } from './informes/Informes';

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
            <Route path="bajas" element={<Bajas />} />
            <Route path="bajas/:id" element={<BajaFicha />} />
            <Route path="informes" element={<Informes />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
