import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider } from './sesion/auth';
import { RutaAdmin, RutaConConexion, RutaPrivada, RutaPublica } from './compartido/Rutas';
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
import { SinConexionProvider } from './sinconexion/SinConexionProvider';
import { ColaProvider } from './sinconexion/ColaProvider';
import { Pendientes } from './sinconexion/Pendientes';
import { PantallaAdminProvisoria } from './admin/PantallaAdminProvisoria';

export function App() {
  return (
    <AuthProvider>
      {/* Copia local del tambo: bloquea con la primera descarga y la mantiene al día (spec 009). */}
      <SinConexionProvider>
        {/* Litros pendientes de sincronizar y su envío automático (spec 009). */}
        <ColaProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<RutaPublica><Login /></RutaPublica>} />
            <Route path="/registro" element={<RutaPublica><Registro /></RutaPublica>} />
            {/* Administrador de la plataforma (spec 014). Pantallas provisorias: las reales llegan en la T5. */}
            <Route path="/admin" element={<RutaAdmin><PantallaAdminProvisoria titulo="Tambos" /></RutaAdmin>} />
            <Route path="/admin/tambos/nuevo" element={<RutaAdmin><PantallaAdminProvisoria titulo="Crear tambo" /></RutaAdmin>} />
            <Route path="/admin/tambos/:id" element={<RutaAdmin><PantallaAdminProvisoria titulo="Detalle del tambo" /></RutaAdmin>} />
            {/* Ruta "de layout": no tiene path propio. Exige sesión y dibuja el menú;
                las rutas hijas se muestran dentro del <Outlet /> del Layout. */}
            <Route element={<RutaPrivada><Layout /></RutaPrivada>}>
              <Route index element={<Inicio />} />
              <Route path="lotes" element={<RutaConConexion><Lotes /></RutaConConexion>} />
              <Route path="semen" element={<RutaConConexion><SemenToros /></RutaConConexion>} />
              <Route path="animales" element={<Animales />} />
              {/* "nuevo" va antes que ":id" (React Router igual prioriza la ruta fija). */}
              <Route path="animales/nuevo" element={<RutaConConexion><AnimalNuevo /></RutaConConexion>} />
              <Route path="animales/planilla" element={<RutaConConexion><AnimalesPlanilla /></RutaConConexion>} />
              <Route path="animales/:id" element={<AnimalFicha />} />
              <Route path="bajas" element={<RutaConConexion><Bajas /></RutaConConexion>} />
              <Route path="bajas/:id" element={<RutaConConexion><BajaFicha /></RutaConConexion>} />
              <Route path="pendientes" element={<Pendientes />} />
              <Route path="informes" element={<RutaConConexion><Informes /></RutaConConexion>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        </ColaProvider>
      </SinConexionProvider>
    </AuthProvider>
  );
}
