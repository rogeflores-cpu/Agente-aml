import { useEffect, useMemo, useState } from 'react';
import { ESTADOS, Insignia, Mensaje, NIVELES, Vacio, fecha } from '../componentes/ui';
import type { EstadoExpediente, FilaBandeja, Fuente } from '../fuente/tipos';

const FILTROS: { clave: string; texto: string; aplica: (f: FilaBandeja) => boolean }[] = [
  { clave: 'atencion', texto: 'Requieren atención', aplica: (f) => f.coincidenciasSinDisponer > 0 || f.alertasAbiertas > 0 || f.estado === 'listo_para_decision' || f.estado === 'en_examen' },
  { clave: 'proceso', texto: 'En proceso', aplica: (f) => ['invitado', 'en_captura', 'en_revision'].includes(f.estado) },
  { clave: 'cerrados', texto: 'Decididos', aplica: (f) => ['aprobado', 'aprobado_condicionado', 'rechazado', 'abstenido'].includes(f.estado) },
  { clave: 'todos', texto: 'Todos', aplica: () => true },
];

export function Bandeja({ fuente, organizacionId, abrir }: { fuente: Fuente; organizacionId: string; abrir: (id: string) => void }) {
  const [filas, setFilas] = useState<FilaBandeja[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('atencion');
  const [busqueda, setBusqueda] = useState('');

  useEffect(() => {
    setFilas(null);
    fuente.bandeja(organizacionId).then(setFilas).catch((e) => setError(e.message));
  }, [fuente, organizacionId]);

  const visibles = useMemo(() => {
    const f = FILTROS.find((x) => x.clave === filtro)!;
    const q = busqueda.trim().toLowerCase();
    return (filas ?? [])
      .filter(f.aplica)
      .filter((x) => !q || x.nombre.toLowerCase().includes(q) || x.codigoOperacion.toLowerCase().includes(q))
      .sort((a, b) => b.coincidenciasSinDisponer - a.coincidenciasSinDisponer || b.alertasAbiertas - a.alertasAbiertas);
  }, [filas, filtro, busqueda]);

  const resumen = useMemo(() => ({
    coincidencias: (filas ?? []).reduce((s, f) => s + f.coincidenciasSinDisponer, 0),
    alertas: (filas ?? []).reduce((s, f) => s + f.alertasAbiertas, 0),
    listos: (filas ?? []).filter((f) => f.estado === 'listo_para_decision').length,
    proceso: (filas ?? []).filter((f) => ['invitado', 'en_captura', 'en_revision'].includes(f.estado)).length,
  }), [filas]);

  if (error) return <Mensaje tipo="error">{error}</Mensaje>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { t: 'Coincidencias por disponer', v: resumen.coincidencias, c: resumen.coincidencias ? 'text-alto' : '' },
          { t: 'Alertas abiertas', v: resumen.alertas, c: resumen.alertas ? 'text-medio' : '' },
          { t: 'Listos para decidir', v: resumen.listos, c: 'text-marca' },
          { t: 'En proceso con el cliente', v: resumen.proceso, c: '' },
        ].map((k) => (
          <div key={k.t} className="rounded-xl border border-borde bg-white px-5 py-4">
            <div className="text-xs font-medium text-tinta-suave">{k.t}</div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${k.c}`}>{filas ? k.v : '…'}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-borde bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-borde px-5 py-3">
          <div className="flex gap-1">
            {FILTROS.map((f) => (
              <button key={f.clave} onClick={() => setFiltro(f.clave)}
                className={`rounded-lg px-3 py-1.5 text-sm ${filtro === f.clave ? 'bg-marca-claro font-medium text-marca' : 'text-tinta-suave hover:bg-papel'}`}>
                {f.texto}
              </button>
            ))}
          </div>
          <input placeholder="Buscar por nombre u operación" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            className="w-64 rounded-lg border border-borde px-3 py-1.5 text-sm outline-none focus:border-marca" />
        </div>
        {!filas ? <Vacio>Cargando…</Vacio> : visibles.length === 0 ? <Vacio>No hay expedientes en esta vista.</Vacio> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-tinta-suave">
                <th className="px-5 py-2.5 font-medium">Cliente</th>
                <th className="px-3 py-2.5 font-medium">Operación</th>
                <th className="px-3 py-2.5 font-medium">Estado</th>
                <th className="px-3 py-2.5 font-medium">Riesgo</th>
                <th className="px-3 py-2.5 font-medium">Atención</th>
                <th className="px-5 py-2.5 text-right font-medium">Actualizado</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => (
                <tr key={f.id} onClick={() => abrir(f.id)} className="cursor-pointer border-t border-borde hover:bg-papel">
                  <td className="px-5 py-3">
                    <div className="font-medium">{f.nombre}</div>
                    <div className="text-xs capitalize text-tinta-suave">{f.parte} · {f.tipoPersona === 'individual' ? 'persona individual' : 'persona jurídica'}</div>
                  </td>
                  <td className="px-3 py-3 tabular-nums">{f.codigoOperacion}</td>
                  <td className="px-3 py-3"><Insignia clase={ESTADOS[f.estado as EstadoExpediente].clase}>{ESTADOS[f.estado as EstadoExpediente].texto}</Insignia></td>
                  <td className="px-3 py-3">{f.nivel ? <Insignia clase={NIVELES[f.nivel].clase}>{NIVELES[f.nivel].texto}</Insignia> : <span className="text-xs text-tinta-suave">Sin evaluar</span>}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {f.coincidenciasSinDisponer > 0 && <Insignia clase="bg-alto-claro text-alto">{f.coincidenciasSinDisponer} coincidencia</Insignia>}
                      {f.alertasAbiertas > 0 && <Insignia clase="bg-medio-claro text-medio">{f.alertasAbiertas} alerta{f.alertasAbiertas > 1 ? 's' : ''}</Insignia>}
                      {f.pendientes > 0 && <Insignia clase="bg-slate-100 text-slate-700">{f.pendientes} pendiente{f.pendientes > 1 ? 's' : ''}</Insignia>}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right text-xs text-tinta-suave">{fecha(f.actualizadoEn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
