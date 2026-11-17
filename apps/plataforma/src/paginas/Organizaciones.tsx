import { useEffect, useState } from 'react';
import { avanceAlta } from '../componentes/Lista';
import { Boton, Insignia, Mensaje, Vacio, fecha } from '../componentes/ui';
import type { EstadoAlta, Fuente } from '../fuente/tipos';

export function Organizaciones({ fuente, abrir, nueva }: { fuente: Fuente; abrir: (id: string) => void; nueva: () => void }) {
  const [orgs, setOrgs] = useState<EstadoAlta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fuente.organizaciones().then(setOrgs).catch((x) => setError(x.message)); }, [fuente]);
  if (error) return <Mensaje tipo="error">{error}</Mensaje>;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Organizaciones</h1>
          <p className="mt-1 text-sm text-tinta-suave">Sujetos obligados que usan la plataforma y lo que les falta para operar.</p>
        </div>
        <Boton onClick={nueva}>Nueva organización</Boton>
      </div>
      <div className="rounded-xl border border-borde bg-white">
        {!orgs ? <Vacio>Cargando…</Vacio> : !orgs.length ? <Vacio>Aún no hay organizaciones.</Vacio> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-tinta-suave">
                <th className="px-5 py-2.5 font-medium">Organización</th>
                <th className="px-3 py-2.5 font-medium">Subdominio</th>
                <th className="px-3 py-2.5 font-medium">Alta</th>
                <th className="px-3 py-2.5 font-medium">Metodología</th>
                <th className="px-3 py-2.5 font-medium">Oficial</th>
                <th className="px-3 py-2.5 font-medium">WhatsApp</th>
                <th className="px-3 py-2.5 font-medium">IVE</th>
                <th className="px-5 py-2.5 text-right font-medium">Creada</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => {
                const n = avanceAlta(o);
                const si = (v: boolean) => <span className={v ? 'text-bajo' : 'text-tinta-suave'}>{v ? '✓' : '—'}</span>;
                return (
                  <tr key={o.id} onClick={() => abrir(o.id)} className="cursor-pointer border-t border-borde hover:bg-papel">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="h-3 w-3 rounded-full" style={{ background: o.marca.colorPrimario }} />
                        <div>
                          <div className="font-medium">{o.nombreComercial}</div>
                          <div className="text-xs text-tinta-suave">{o.nombreLegal} · NIT {o.nit}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">{o.subdominio}</td>
                    <td className="px-3 py-3">
                      {o.listaParaOperar
                        ? <Insignia clase="bg-bajo-claro text-bajo">Lista para operar</Insignia>
                        : <Insignia clase="bg-medio-claro text-medio">{n} de 4</Insignia>}
                    </td>
                    <td className="px-3 py-3">{o.metodologiaVersionAprobada ? <span className="text-bajo">v{o.metodologiaVersionAprobada}</span> : <span className="text-medio">Por aprobar</span>}</td>
                    <td className="px-3 py-3">{si(o.oficiales > 0)}</td>
                    <td className="px-3 py-3">{o.whatsappEstado === 'activo' ? si(true) : o.whatsappEstado ? <span className="text-medio">{o.whatsappEstado}</span> : si(false)}</td>
                    <td className="px-3 py-3">{si(!!o.inscripcionIve)}</td>
                    <td className="px-5 py-3 text-right text-xs text-tinta-suave">{fecha(o.creadoEn)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
