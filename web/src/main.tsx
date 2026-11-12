import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './estilos.css';
import { registrarSw } from './sinconexion/registrarSw';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Instalable y con el código guardado para abrir sin conexión (solo en la versión compilada).
registrarSw();
