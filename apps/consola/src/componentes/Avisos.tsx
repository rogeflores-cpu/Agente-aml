import { useEffect, useState } from 'react';
import type { Aviso, Fuente } from '../fuente/tipos';
import { fecha } from './ui';

export function Avisos({ fuente, organizacionId, abrir }: { fuente: Fuente; organizacionId: string; abrir: (id: string) => void }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [abierto, setAbierto] = useState(false);
  useEffect(() => {
    const cargar = () => fuente.avisos(organizacionId).then(setAvisos).catch(() => {});
    cargar();
    const t = setInterval(cargar, 60_000);
    return () => clearInterval(t);
  }, [fuente, organizacionId]);
  const sinLeer = avisos.filter((a) => !a.leida).length;
  const color = { urgente: 'bg-alto', alta: 'bg-medio', normal: 'bg-marca' };

  return (
    <div className="relative">
      <button onClick={() => setAbierto(!abierto)} className="relative rounded-lg border border-borde bg-white px-3 py-1.5 text-sm hover:bg-papel">
        Avisos
        {sinLeer > 0 && <span className="ml-2 rounded-full bg-alto px-1.5 text-xs font-semibold text-white">{sinLeer}</span>}
      </button>
      {abierto && (
        <div className="absolute right-0 z-10 mt-2 w-96 rounded-xl border border-borde bg-white shadow-lg">
          {avisos.length === 0 ? <p className="p-4 text-sm text-tinta-suave">Sin avisos.</p> : (
            <ul className="max-h-96 divide-y divide-borde overflow-y-auto">
              {avisos.map((a) => (
                <li key={a.id}>
                  <button className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-papel ${a.leida ? 'opacity-60' : ''}`}
                    onClick={async () => {
                      await fuente.marcarLeido(a.id);
                      setAvisos(avisos.map((x) => (x.id === a.id ? { ...x, leida: true } : x)));
                      if (a.expedienteId) { abrir(a.expedienteId); setAbierto(false); }
                    }}>
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${color[a.prioridad]}`} />
                    <span className="text-sm">
                      <span className="block font-medium">{a.asunto}</span>
                      <span className="block text-tinta-suave">{a.cuerpo}</span>
                      <span className="mt-1 block text-xs text-tinta-suave">{fecha(a.creadaEn)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
