import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './estilos.css';
import { fuenteApi } from './fuente/api';
import { fuenteDemo } from './fuente/demo';

const fuente = import.meta.env.VITE_MODO_DEMO === '1' ? fuenteDemo() : fuenteApi();

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <App fuente={fuente} />
  </StrictMode>,
);
