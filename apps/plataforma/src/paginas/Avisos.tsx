import { useEffect, useState } from 'react';
import { Boton, Mensaje, Tarjeta, Vacio, fecha } from '../componentes/ui';
import type { AvisoPlataforma, Fuente } from '../fuente/tipos';

export function Avisos({ fuente, alCambiar }: { fuente: Fuente; alCambiar: () => void }) {
  const [avisos, setAvisos] = useState<AvisoPlataforma[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = () => fuente.avisos().then(setAvisos).catch((x) => setError(x.message));
  useEffect(() => { cargar(); }, [fuente]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Avisos de la plataforma</h1>
        <p className="mt-1 text-sm text-tinta-suave">Tareas que el sistema detectó para el administrador, como cargar las listas de un nuevo pleno del GAFI.</p>
      </div>
      {error && <Mensaje tipo="error">{error}</Mensaje>}
      <Tarjeta>
        {!avisos ? <Vacio>Cargando…</Vacio> : !avisos.length ? <Vacio>Sin avisos.</Vacio> : (
          <ul className="divide-y divide-borde">
            {avisos.map((a) => (
              <li key={a.id} className={`flex items-start justify-between gap-4 py-3 ${a.atendidoEn ? 'opacity-60' : ''}`}>
                <div className="text-sm">
                  <div className="font-medium">{a.asunto}</div>
                  <div className="text-tinta-suave">{a.cuerpo}</div>
                  <div className="mt-1 text-xs text-tinta-suave">{fecha(a.creadoEn)}{a.atendidoEn && ` · atendido ${fecha(a.atendidoEn)}`}</div>
                </div>
                {!a.atendidoEn && <Boton tipo="secundario" onClick={async () => {
                  try { await fuente.atenderAviso(a.id); cargar(); alCambiar(); } catch (x) { setError((x as Error).message); }
                }}>Marcar atendido</Boton>}
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>
    </div>
  );
}
