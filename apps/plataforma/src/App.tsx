import { useEffect, useState } from 'react';
import { Vacio } from './componentes/ui';
import type { Fuente } from './fuente/tipos';
import { Asistente } from './paginas/Asistente';
import { Avisos } from './paginas/Avisos';
import { Designaciones1373 } from './paginas/Designaciones1373';
import { Detalle } from './paginas/Detalle';
import { FijarClave } from './paginas/FijarClave';
import { Ingreso } from './paginas/Ingreso';
import { ListasGafi } from './paginas/ListasGafi';
import { Organizaciones } from './paginas/Organizaciones';

type Vista = { tipo: 'organizaciones' } | { tipo: 'nueva' } | { tipo: 'detalle'; id: string } | { tipo: 'gafi' } | { tipo: 'designaciones' } | { tipo: 'avisos' };

export function App({ fuente }: { fuente: Fuente }) {
  const [sesion, setSesion] = useState<{ correo: string } | null | undefined>(undefined);
  const [vista, setVista] = useState<Vista>({ tipo: 'organizaciones' });
  const [pendientes, setPendientes] = useState(0);
  const contarAvisos = () => fuente.avisos().then((a) => setPendientes(a.filter((x) => !x.atendidoEn).length)).catch(() => {});

  const [enlace, setEnlace] = useState(() => fuente.enlace());
  useEffect(() => { fuente.sesion().then(setSesion); }, [fuente]);
  useEffect(() => { if (sesion) contarAvisos(); }, [sesion]);

  if (sesion === undefined) return <Vacio>Cargando…</Vacio>;
  if (!sesion) {
    return <Ingreso modoDemo={fuente.modoDemo} avisoInicial={enlace?.tipo === 'error' ? enlace.mensaje : null}
      alRecuperar={(c) => fuente.recuperarClave(c)}
      alIngresar={async (c, k) => { await fuente.iniciarSesion(c, k); setEnlace(null); setSesion(await fuente.sesion()); }} />;
  }
  if (enlace?.tipo === 'clave') {
    return <FijarClave correo={sesion.correo} motivo={enlace.motivo} alGuardar={async (k) => { await fuente.fijarClave(k); setEnlace(null); }} />;
  }

  const menu: { clave: Vista['tipo']; texto: string; cuenta?: number }[] = [
    { clave: 'organizaciones', texto: 'Organizaciones' },
    { clave: 'gafi', texto: 'Listas GAFI' },
    { clave: 'designaciones', texto: 'Designaciones 1373' },
    { clave: 'avisos', texto: 'Avisos', cuenta: pendientes || undefined },
  ];
  const activa = vista.tipo === 'nueva' || vista.tipo === 'detalle' ? 'organizaciones' : vista.tipo;

  return (
    <div className="min-h-screen">
      <header className="border-b border-borde bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-tinta text-xs font-bold text-white">AML</div>
              <div className="text-sm font-semibold">Administración de la plataforma</div>
              {fuente.modoDemo && <span className="rounded-full bg-medio-claro px-2.5 py-0.5 text-xs font-medium text-medio">Demostración · datos ficticios</span>}
            </div>
            <nav className="flex gap-1">
              {menu.map((m) => (
                <button key={m.clave} onClick={() => setVista({ tipo: m.clave } as Vista)}
                  className={`rounded-lg px-3 py-1.5 text-sm ${activa === m.clave ? 'bg-marca-claro font-medium text-marca' : 'text-tinta-suave hover:bg-papel'}`}>
                  {m.texto}
                  {m.cuenta !== undefined && <span className="ml-1.5 rounded-full bg-alto px-1.5 text-xs font-semibold text-white">{m.cuenta}</span>}
                </button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="font-medium">{sesion.correo}</span>
            <button className="text-tinta-suave hover:text-tinta" onClick={async () => { await fuente.cerrarSesion(); setSesion(null); }}>Salir</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">
        {vista.tipo === 'organizaciones' && <Organizaciones fuente={fuente} abrir={(id) => setVista({ tipo: 'detalle', id })} nueva={() => setVista({ tipo: 'nueva' })} />}
        {vista.tipo === 'nueva' && <Asistente fuente={fuente} terminar={(id) => setVista({ tipo: 'detalle', id })} cancelar={() => setVista({ tipo: 'organizaciones' })} />}
        {vista.tipo === 'detalle' && <Detalle fuente={fuente} id={vista.id} volver={() => setVista({ tipo: 'organizaciones' })} />}
        {vista.tipo === 'gafi' && <ListasGafi fuente={fuente} />}
        {vista.tipo === 'designaciones' && <Designaciones1373 fuente={fuente} />}
        {vista.tipo === 'avisos' && <Avisos fuente={fuente} alCambiar={contarAvisos} />}
      </main>
    </div>
  );
}
