import { buscarEnListas, MINIMO_BUSQUEDA, type FuenteLista, type RegistroLista } from '@agente-aml/listas';
import { z } from 'zod';
import { db, sinError } from './datos.js';
import { cargarDesignacionesVigentes } from './designaciones.js';
import { cargarListaVigente } from './lista-onu.js';

/**
 * Búsqueda libre en las listas cargadas (ONU y designaciones S/RES/1373) para
 * la plataforma y para el personal de cumplimiento. Solo consulta: no registra
 * verificaciones ni cambia expedientes.
 */
export const esquemaBusquedaListas = z.object({
  q: z.string().trim().min(MINIMO_BUSQUEDA, `Escriba al menos ${MINIMO_BUSQUEDA} caracteres`).max(120),
  tipo: z.enum(['individual', 'entidad']).optional(),
});

// Las listas cambian una vez al día (ONU) o a mano (1373): se guardan un minuto en memoria.
let enMemoria: { hasta: number; onu: RegistroLista[]; designaciones: RegistroLista[] } | null = null;

async function listas() {
  if (enMemoria && enMemoria.hasta > Date.now()) return enMemoria;
  const [onu, designaciones] = await Promise.all([cargarListaVigente(), cargarDesignacionesVigentes()]);
  enMemoria = { hasta: Date.now() + 60_000, onu: onu.registros, designaciones: designaciones.registros };
  return enMemoria;
}

export async function buscarListas(p: z.infer<typeof esquemaBusquedaListas>) {
  const [l, version] = await Promise.all([
    listas(),
    sinError(db().from('lista_onu_versiones').select('generada_el, cargada_en').order('cargada_en', { ascending: false }).limit(1).maybeSingle()),
  ]);
  const fuentes: { fuente: FuenteLista; registros: RegistroLista[] }[] = [
    { fuente: 'onu', registros: l.onu },
    { fuente: 'designacion_1373', registros: l.designaciones },
  ];
  const resultados = buscarEnListas(p.q, fuentes, { tipo: p.tipo }).map((r) => ({
    fuente: r.fuente, motivo: r.motivo, puntaje: r.puntaje, nombreCoincidente: r.nombreCoincidente, ...r.registro,
  }));
  return {
    listas: {
      onuRegistros: l.onu.length,
      onuGeneradaEl: (version as any)?.generada_el ?? null,
      onuCargadaEn: (version as any)?.cargada_en ?? null,
      designaciones1373: l.designaciones.length,
    },
    resultados,
  };
}
