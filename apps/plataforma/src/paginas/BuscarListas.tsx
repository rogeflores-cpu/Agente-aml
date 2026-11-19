import { useState } from 'react';
import { Boton, Insignia, Mensaje, Tarjeta, Vacio } from '../componentes/ui';
import type { RespuestaBusquedaListas, ResultadoLista } from '../fuente/tipos';

const MOTIVO: Record<ResultadoLista['motivo'], string> = { referencia: 'Por referencia', documento: 'Por documento', nombre: 'Por nombre o alias' };
const FUENTE: Record<ResultadoLista['fuente'], { texto: string; clase: string }> = {
  onu: { texto: 'ONU', clase: 'bg-marca-claro text-marca' },
  designacion_1373: { texto: 'S/RES/1373', clase: 'bg-alto-claro text-alto' },
  ofac: { texto: 'OFAC (EE. UU.)', clase: 'bg-medio-claro text-medio' },
};
const fechaCorta = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-GT', { timeZone: 'America/Guatemala', dateStyle: 'medium', timeStyle: 'short' }) : '—';

/**
 * Búsqueda libre en la lista consolidada de la ONU y en las designaciones
 * S/RES/1373 cargadas. Es una consulta: no registra verificaciones ni cambia
 * expedientes (el cotejo formal lo hace el sistema al recibir los datos).
 */
export function BuscarListas({ buscar }: { buscar: (q: string, tipo?: 'individual' | 'entidad') => Promise<RespuestaBusquedaListas> }) {
  const [q, setQ] = useState('');
  const [tipo, setTipo] = useState<'' | 'individual' | 'entidad'>('');
  const [r, setR] = useState<RespuestaBusquedaListas | null>(null);
  const [buscado, setBuscado] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const campo = 'rounded-lg border border-borde bg-white px-3 py-2 text-sm outline-none focus:border-marca';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Buscar en las listas</h1>
        <p className="mt-1 text-sm text-tinta-suave">
          Lista consolidada del Consejo de Seguridad de la ONU y designaciones S/RES/1373 cargadas (art. 43), y lista SDN de la OFAC (EE. UU.). Busque por nombre, alias,
          parte del nombre, número de referencia (p. ej. QDi.123) o número de documento. Es solo una consulta: no registra una verificación.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3" onSubmit={async (e) => {
        e.preventDefault();
        setCargando(true); setError(null);
        try { setR(await buscar(q.trim(), tipo || undefined)); setBuscado(q.trim()); } catch (x) { setError((x as Error).message); } finally { setCargando(false); }
      }}>
        <label className="block min-w-[16rem] flex-1 text-sm">
          <span className="mb-1 block font-medium">Nombre, alias, referencia o documento</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej.: Juan Carlos Méndez, QDi.123" className={`w-full ${campo}`} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Tipo</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} className={campo}>
            <option value="">Personas y entidades</option>
            <option value="individual">Solo personas</option>
            <option value="entidad">Solo entidades</option>
          </select>
        </label>
        <Boton type="submit" disabled={cargando || q.trim().length < 3}>{cargando ? 'Buscando…' : 'Buscar'}</Boton>
      </form>

      {error && <Mensaje tipo="error">{error}</Mensaje>}

      {r && (
        <>
          <p className="text-xs text-tinta-suave">
            Lista ONU: {r.listas.onuRegistros.toLocaleString('es-GT')} registros · generada por la ONU el {fechaCorta(r.listas.onuGeneradaEl)} · cargada el {fechaCorta(r.listas.onuCargadaEn)}
            {' · '}Designaciones 1373 vigentes: {r.listas.designaciones1373}
            {' · '}OFAC SDN: {r.listas.ofacRegistros ? `${r.listas.ofacRegistros.toLocaleString('es-GT')} registros, publicada el ${r.listas.ofacGeneradaEl ?? '—'}` : 'aún no cargada'}
          </p>
          <Tarjeta titulo={`Resultados para «${buscado}»`} accion={<Insignia clase="bg-papel text-tinta-suave">{r.resultados.length}</Insignia>}>
            {!r.resultados.length ? (
              <Vacio>Sin resultados en las listas cargadas. Revise la ortografía o pruebe con otra parte del nombre.</Vacio>
            ) : (
              <ul className="divide-y divide-borde">
                {r.resultados.map((x) => (
                  <li key={`${x.fuente}-${x.referencia}`} className="space-y-1 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{x.nombre}</span>
                      <Insignia clase={FUENTE[x.fuente].clase}>{FUENTE[x.fuente].texto}</Insignia>
                      <Insignia clase="bg-papel text-tinta-suave">{x.tipo === 'individual' ? 'Persona' : 'Entidad'}</Insignia>
                      <span className="text-xs text-tinta-suave">{MOTIVO[x.motivo]} · similitud {Math.round(x.puntaje * 100)} %</span>
                    </div>
                    <div className="text-xs text-tinta-suave">
                      Referencia <span className="font-medium text-tinta">{x.referencia.replace(/^1373:.*/, 'designación 1373')}</span> · {x.lista}
                      {x.incluidoEl && <> · incluido el {x.incluidoEl}</>}
                    </div>
                    {x.nombreCoincidente !== x.nombre && <div className="text-xs">Coincide con el alias: <span className="font-medium">{x.nombreCoincidente}</span></div>}
                    {!!x.alias.length && <div className="text-xs text-tinta-suave">Alias: {x.alias.join(' · ')}</div>}
                    <div className="text-xs text-tinta-suave">
                      {!!x.fechasNacimiento.length && <>Nacimiento: {x.fechasNacimiento.join(', ')} · </>}
                      {!!x.nacionalidades.length && <>Nacionalidad: {x.nacionalidades.join(', ')} · </>}
                      {!!x.documentos.length && <>Documentos: {x.documentos.join(', ')}</>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>
          <p className="text-xs text-tinta-suave">
            Un resultado aquí no confirma una coincidencia: compare fecha de nacimiento, nacionalidad y documentos. Si corresponde a un cliente,
            la disposición se hace en el expediente. Una coincidencia con OFAC no activa el bloqueo del art. 43: exige debida diligencia intensificada.
          </p>
        </>
      )}
    </div>
  );
}
