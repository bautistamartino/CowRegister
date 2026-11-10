import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider } from './auth';
import { RutaPrivada, RutaPublica } from './componentes/Rutas';
import { Login } from './paginas/Login';
import { Registro } from './paginas/Registro';
import { Inicio } from './paginas/Inicio';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<RutaPublica><Login /></RutaPublica>} />
          <Route path="/registro" element={<RutaPublica><Registro /></RutaPublica>} />
          <Route path="/" element={<RutaPrivada><Inicio /></RutaPrivada>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
