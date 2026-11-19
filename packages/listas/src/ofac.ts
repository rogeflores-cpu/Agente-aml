import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import type { ListaCargada, RegistroLista } from './onu.js';

/**
 * Lista SDN (Specially Designated Nationals) de la OFAC del Tesoro de EE. UU.
 *
 * No es una lista del art. 43 del Decreto 15-2026 (ese artículo se refiere a
 * las listas del Consejo de Seguridad de la ONU): una coincidencia con OFAC
 * genera alerta al oficial y debida diligencia intensificada, sin bloqueo
 * preventivo ni comunicación al Ministerio Público.
 *
 * Formato: el XML clásico de la SDN (sdnList > sdnEntry). Se descarga de la
 * dirección configurada en OFAC_LISTA_URL. Buques y aeronaves no se cargan:
 * el cotejo es de personas y entidades.
 *
 * El archivo es grande: se lee POR PARTES (un sdnEntry a la vez) para no
 * cargar todo el documento en memoria. Con el documento completo, el
 * servidor de 512 MB se quedaba sin memoria.
 */

const comoArreglo = <T>(x: T | T[] | undefined | null): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
const texto = (x: unknown): string => (x == null ? '' : String(x)).trim();

const MESES: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
};

/** "12 Jan 1970" → 1970-01-12; "circa 1970", "1970 to 1975", "Jan 1970" → 1970. */
export function fechaOfac(s: string): string | null {
  const t = s.trim();
  const completa = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(t);
  if (completa && MESES[completa[2].toUpperCase()]) {
    return `${completa[3]}-${MESES[completa[2].toUpperCase()]}-${completa[1].padStart(2, '0')}`;
  }
  const anio = /\b(1[89]\d{2}|20\d{2})\b/.exec(t);
  return anio ? anio[1] : null;
}

const nombreCompleto = (x: { firstName?: unknown; lastName?: unknown }) =>
  [texto(x.firstName), texto(x.lastName)].filter(Boolean).join(' ');

/** Convierte un sdnEntry ya leído; null si es buque, aeronave o no trae nombre. */
function registroOfac(e: Record<string, any>): RegistroLista | null {
  const tipoOfac = texto(e.sdnType).toLowerCase();
  if (tipoOfac !== 'individual' && tipoOfac !== 'entity') return null;
  const tipo = tipoOfac === 'individual' ? 'individual' : 'entidad';
  const nombre = tipo === 'individual' ? nombreCompleto(e) : texto(e.lastName);
  if (!texto(e.uid) || !nombre) return null;
  const programas = comoArreglo(e.programList?.program).map(texto).filter(Boolean);
  return {
    referencia: `OFAC-${texto(e.uid)}`,
    lista: `OFAC SDN${programas.length ? ` · ${programas.join(', ')}` : ''}`,
    tipo,
    nombre,
    alias: [...new Set(comoArreglo<Record<string, unknown>>(e.akaList?.aka).map(nombreCompleto).filter((a) => a && a !== nombre))],
    fechasNacimiento: [...new Set(comoArreglo<Record<string, unknown>>(e.dateOfBirthList?.dateOfBirthItem)
      .map((d) => fechaOfac(texto(d.dateOfBirth))).filter((d): d is string => !!d))],
    nacionalidades: [...new Set([
      ...comoArreglo<Record<string, unknown>>(e.nationalityList?.nationality),
      ...comoArreglo<Record<string, unknown>>(e.citizenshipList?.citizenship),
    ].map((n) => texto(n.country)).filter(Boolean))],
    documentos: [...new Set(comoArreglo<Record<string, unknown>>(e.idList?.id).map((d) => texto(d.idNumber)).filter(Boolean))],
  };
}

const CIERRE = /<\/(?:[\w-]+:)?sdnEntry\s*>/g;
const APERTURA = /<(?:[\w-]+:)?sdnEntry[\s>]/g;

/**
 * Lector por partes: se le entregan trozos de texto del XML en orden y va
 * convirtiendo cada sdnEntry completo. Calcula el SHA-256 del texto completo.
 */
export class LectorOfac {
  private pendiente = '';
  private hash = createHash('sha256');
  private parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, trimValues: true });
  private vioRaiz = false;
  private publicada: string | undefined;
  readonly registros: RegistroLista[] = [];

  agregar(trozo: string): void {
    this.hash.update(trozo);
    this.pendiente += trozo;
    if (!this.vioRaiz && /<(?:[\w-]+:)?sdnList[\s>]/.test(this.pendiente)) this.vioRaiz = true;
    if (!this.publicada) {
      const p = /<(?:[\w-]+:)?Publish_Date>([^<]*)</.exec(this.pendiente);
      if (p) this.publicada = p[1].trim();
    }
    let fin = 0;
    CIERRE.lastIndex = 0;
    for (let m = CIERRE.exec(this.pendiente); m; m = CIERRE.exec(this.pendiente)) {
      const hasta = m.index + m[0].length;
      // Apertura más cercana antes de este cierre
      let desde = -1;
      APERTURA.lastIndex = fin;
      for (let a = APERTURA.exec(this.pendiente); a && a.index < m.index; a = APERTURA.exec(this.pendiente)) desde = a.index;
      if (desde >= 0) {
        const e = this.parser.parse(this.pendiente.slice(desde, hasta))?.sdnEntry;
        const r = e ? registroOfac(e) : null;
        if (r) this.registros.push(r);
      }
      fin = hasta;
    }
    // Se conserva solo lo que falta por cerrar (máximo un sdnEntry incompleto)
    if (fin) this.pendiente = this.pendiente.slice(fin);
    else if (this.vioRaiz && this.publicada && this.pendiente.length > 2_000_000) {
      throw new Error('El archivo de OFAC trae un registro demasiado grande o con otro formato');
    }
  }

  terminar(): ListaCargada {
    if (!this.vioRaiz) throw new Error('El archivo de OFAC no tiene el formato esperado (sdnList)');
    // Un archivo vacío o con otro formato no debe reemplazar la lista vigente.
    if (!this.registros.length) throw new Error('El archivo de OFAC no trae registros de personas ni entidades');
    return { generadaEl: this.publicada, sha256: this.hash.digest('hex'), registros: this.registros };
  }
}

/** Lee la lista completa desde un texto (pruebas y archivos pequeños). */
export function parsearListaOfac(xml: string): ListaCargada {
  const l = new LectorOfac();
  l.agregar(xml);
  return l.terminar();
}

/** Lee la lista desde trozos de texto (descarga por partes). */
export async function leerListaOfac(trozos: AsyncIterable<string>): Promise<ListaCargada> {
  const l = new LectorOfac();
  for await (const t of trozos) l.agregar(t);
  return l.terminar();
}
