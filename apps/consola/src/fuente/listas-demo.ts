import type { RespuestaBusquedaListas, ResultadoLista } from './tipos';

/** Registros ficticios para el modo demostración (no son de la lista real). */
const REGISTROS: Omit<ResultadoLista, 'fuente' | 'motivo' | 'puntaje' | 'nombreCoincidente'>[] = [
  { referencia: 'QDi.900', lista: 'Al-Qaida (ficticio)', tipo: 'individual', nombre: 'Persona Ficticia Uno', alias: ['El Ejemplo'], fechasNacimiento: ['1970'], nacionalidades: ['XX'], documentos: ['X0000001'], incluidoEl: '2010-01-01' },
  { referencia: 'QDe.900', lista: 'Al-Qaida (ficticio)', tipo: 'entidad', nombre: 'Fundación Ficticia de Demostración', alias: [], fechasNacimiento: [], nacionalidades: [], documentos: [], incluidoEl: '2012-05-05' },
];

const limpio = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function buscarDemo(q: string, tipo?: 'individual' | 'entidad'): RespuestaBusquedaListas {
  const t = limpio(q.trim());
  const resultados: ResultadoLista[] = REGISTROS
    .filter((r) => !tipo || r.tipo === tipo)
    .flatMap((r): ResultadoLista[] => {
      if (limpio(r.referencia) === t) return [{ ...r, fuente: 'onu' as const, motivo: 'referencia' as const, puntaje: 1, nombreCoincidente: r.nombre }];
      const n = [r.nombre, ...r.alias].find((x) => limpio(x).includes(t));
      return n ? [{ ...r, fuente: 'onu' as const, motivo: 'nombre' as const, puntaje: 0.9, nombreCoincidente: n }] : [];
    });
  return { listas: { onuRegistros: REGISTROS.length, onuGeneradaEl: null, onuCargadaEn: null, designaciones1373: 0, ofacRegistros: 0, ofacGeneradaEl: null, ofacCargadaEn: null }, resultados };
}
