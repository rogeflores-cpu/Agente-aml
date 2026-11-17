import type { RegistroLista } from '@agente-aml/listas';
import { db, sinError } from './datos.js';

/**
 * Designaciones de la resolución S/RES/1373(2001) (art. 43 c). No están en la
 * lista consolidada de la ONU y no tienen descarga automática: la plataforma
 * las registra a mano con la autoridad y la referencia del documento.
 */
export interface FilaDesignacion {
  id: string;
  tipo: 'individual' | 'entidad';
  nombre: string;
  alias: string[];
  documentos: string[];
  fechas_nacimiento: string[];
  nacionalidades: string[];
  autoridad: string;
  referencia: string;
}

/** Convierte una designación al formato de registro que usa el cotejo. */
export function comoRegistro(d: FilaDesignacion): RegistroLista {
  return {
    referencia: `1373:${d.id}`,
    lista: `S/RES/1373 · ${d.autoridad} · ${d.referencia}`,
    tipo: d.tipo,
    nombre: d.nombre,
    alias: d.alias ?? [],
    fechasNacimiento: d.fechas_nacimiento ?? [],
    nacionalidades: d.nacionalidades ?? [],
    documentos: d.documentos ?? [],
  };
}

/**
 * Versión del conjunto de designaciones (cambia con cada alta o revocación).
 * Null si la plataforma nunca registró ninguna: entonces no se exige cotejo 1373.
 */
export async function versionDesignaciones(): Promise<string | null> {
  const { data, error } = await db().rpc('version_designaciones_1373');
  if (error) throw new Error(`No se pudo leer la versión de las designaciones 1373: ${error.message}`);
  return (data as string | null) ?? null;
}

export async function cargarDesignacionesVigentes(): Promise<{ version: string | null; registros: RegistroLista[] }> {
  const [version, filas] = await Promise.all([
    versionDesignaciones(),
    sinError(db().from('designaciones_1373_vigentes')
      .select('id, tipo, nombre, alias, documentos, fechas_nacimiento, nacionalidades, autoridad, referencia')),
  ]);
  return { version, registros: ((filas ?? []) as FilaDesignacion[]).map(comoRegistro) };
}
