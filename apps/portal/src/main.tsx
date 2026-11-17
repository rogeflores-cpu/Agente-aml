import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './estilos.css';
import { fuenteApi, tokenDelEnlace } from './fuente/api';
import { fuenteDemo } from './fuente/demo';

const demo = import.meta.env.VITE_MODO_DEMO === '1';
const token = demo ? null : tokenDelEnlace();
const fuente = demo ? fuenteDemo() : token ? fuenteApi(token) : null;

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <App fuente={fuente} />
  </StrictMode>,
);
