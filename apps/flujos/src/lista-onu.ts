import type { RegistroLista } from '@agente-aml/listas';
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
