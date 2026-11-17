import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

/**
 * Lista consolidada del Consejo de Seguridad de la ONU (art. 43 del
 * Decreto 15-2026). Se descarga en XML desde el sitio oficial del Consejo
 * de Seguridad; la dirección se configura en ONU_LISTA_URL.
 */
export interface RegistroLista {
  referencia: string;          // REFERENCE_NUMBER, p. ej. QDi.001
  lista: string;               // UN_LIST_TYPE
  tipo: 'individual' | 'entidad';
  nombre: string;
  alias: string[];
  fechasNacimiento: string[];  // AAAA-MM-DD o AAAA
  nacionalidades: string[];
  documentos: string[];
  incluidoEl?: string;         // LISTED_ON
}

export interface ListaCargada {
  generadaEl?: string;
  /** SHA-256 del archivo recibido: se guarda como version_fuente en cada verificación. */
  sha256: string;
  registros: RegistroLista[];
}

const comoArreglo = <T>(v: T | T[] | undefined): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const texto = (v: unknown): string => (v === undefined || v === null ? '' : String(v).trim());

function nombreCompleto(n: Record<string, unknown>): string {
  return ['FIRST_NAME', 'SECOND_NAME', 'THIRD_NAME', 'FOURTH_NAME']
    .map((k) => texto(n[k]))
    .filter(Boolean)
    .join(' ');
}

function aliasDe(lista: unknown): string[] {
  return comoArreglo(lista as Record<string, unknown>[])
    .map((a) => texto(a?.ALIAS_NAME))
    .filter(Boolean);
}

export function parsearListaOnu(xml: string): ListaCargada {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: false, trimValues: true });
  const doc = parser.parse(xml);
  const raiz = doc?.CONSOLIDATED_LIST;
  if (!raiz) throw new Error('El archivo no tiene la estructura CONSOLIDATED_LIST de la ONU');

  const individuos = comoArreglo(raiz.INDIVIDUALS?.INDIVIDUAL).map((i: Record<string, any>): RegistroLista => ({
    referencia: texto(i.REFERENCE_NUMBER),
    lista: texto(i.UN_LIST_TYPE),
    tipo: 'individual',
    nombre: nombreCompleto(i),
    alias: aliasDe(i.INDIVIDUAL_ALIAS),
    fechasNacimiento: comoArreglo(i.INDIVIDUAL_DATE_OF_BIRTH)
      .map((f: Record<string, unknown>) => texto(f?.DATE) || texto(f?.YEAR))
      .filter(Boolean),
    nacionalidades: comoArreglo(i.NATIONALITY?.VALUE).map(texto).filter(Boolean),
    documentos: comoArreglo(i.INDIVIDUAL_DOCUMENT).map((d: Record<string, unknown>) => texto(d?.NUMBER)).filter(Boolean),
    incluidoEl: texto(i.LISTED_ON) || undefined,
  }));

  const entidades = comoArreglo(raiz.ENTITIES?.ENTITY).map((e: Record<string, any>): RegistroLista => ({
    referencia: texto(e.REFERENCE_NUMBER),
    lista: texto(e.UN_LIST_TYPE),
    tipo: 'entidad',
    nombre: nombreCompleto(e),
    alias: aliasDe(e.ENTITY_ALIAS),
    fechasNacimiento: [],
    nacionalidades: [],
    documentos: [],
    incluidoEl: texto(e.LISTED_ON) || undefined,
  }));

  return {
    generadaEl: texto(raiz['@dateGenerated']) || undefined,
    sha256: createHash('sha256').update(xml).digest('hex'),
    registros: [...individuos, ...entidades].filter((r) => r.nombre),
  };
}

/** Compara dos versiones de la lista para disparar el recotejo de la cartera. */
export function cambiosEntreVersiones(anterior: RegistroLista[], nueva: RegistroLista[]) {
  const clave = (r: RegistroLista) => r.referencia;
  const firma = (r: RegistroLista) => JSON.stringify([r.nombre, [...r.alias].sort(), r.fechasNacimiento]);
  const previos = new Map(anterior.map((r) => [clave(r), firma(r)]));
  const actuales = new Set(nueva.map(clave));
  return {
    agregados: nueva.filter((r) => !previos.has(clave(r))),
    modificados: nueva.filter((r) => previos.has(clave(r)) && previos.get(clave(r)) !== firma(r)),
    retirados: anterior.filter((r) => !actuales.has(clave(r))).map(clave),
  };
}
