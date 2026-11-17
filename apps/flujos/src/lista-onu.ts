import { cambiosEntreVersiones, type RegistroLista } from '@agente-aml/listas';
import { db, sinError } from './datos.js';

/** Carga la lista ONU vigente desde la base, por páginas. */
export async function cargarListaVigente(): Promise<{ sha256: string | null; registros: RegistroLista[] }> {
  const version = await sinError(
    db().from('lista_onu_versiones').select('sha256').order('cargada_en', { ascending: false }).limit(1).maybeSingle(),
  );
  const registros: RegistroLista[] = [];
  for (let desde = 0; ; desde += 1000) {
    const pagina = (await sinError(
      db().from('lista_onu_registros').select('datos').order('referencia').range(desde, desde + 999),
    )) ?? [];
    registros.push(...(pagina as { datos: RegistroLista }[]).map((p) => p.datos));
    if (pagina.length < 1000) break;
  }
  return { sha256: (version as any)?.sha256 ?? null, registros };
}

export interface PlanActualizacion {
  sinCambios: boolean;
  /** Registros contra los que hay que recotejar la cartera. */
  revisar: RegistroLista[];
  retirados: string[];
}

/**
 * Decide qué recotejar al llegar una lista nueva (A5). Si un intento anterior
 * dejó la carga a medias (hay registros con la versión nueva pero la versión
 * no quedó registrada), no se puede saber qué cambió: se recoteja contra toda
 * la lista nueva.
 */
export function planificarActualizacion(
  anterior: { sha256: string | null; registros: RegistroLista[] },
  nueva: { sha256: string; registros: RegistroLista[] },
  cargaParcialPrevia: boolean,
): PlanActualizacion {
  if (anterior.sha256 === nueva.sha256 && !cargaParcialPrevia) return { sinCambios: true, revisar: [], retirados: [] };
  const c = cambiosEntreVersiones(anterior.registros, nueva.registros);
  return {
    sinCambios: false,
    revisar: cargaParcialPrevia || !anterior.sha256 ? nueva.registros : [...c.agregados, ...c.modificados],
    retirados: c.retirados,
  };
}
