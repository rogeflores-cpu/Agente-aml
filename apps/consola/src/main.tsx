import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './estilos.css';
import { fuenteDemo } from './fuente/demo';
import { fuenteSupabase } from './fuente/supabase';

const fuente = import.meta.env.VITE_MODO_DEMO === '1' ? fuenteDemo() : fuenteSupabase();

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <App fuente={fuente} />
  </StrictMode>,
);
