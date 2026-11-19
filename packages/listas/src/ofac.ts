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

export function parsearListaOfac(xml: string): ListaCargada {
  const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, trimValues: true });
  const raiz = parser.parse(xml)?.sdnList;
  if (!raiz) throw new Error('El archivo de OFAC no tiene el formato esperado (sdnList)');

  const registros: RegistroLista[] = [];
  for (const e of comoArreglo<Record<string, any>>(raiz.sdnEntry)) {
    const tipoOfac = texto(e.sdnType).toLowerCase();
    if (tipoOfac !== 'individual' && tipoOfac !== 'entity') continue;
    const tipo = tipoOfac === 'individual' ? 'individual' : 'entidad';
    const nombre = tipo === 'individual' ? nombreCompleto(e) : texto(e.lastName);
    if (!texto(e.uid) || !nombre) continue;
    const programas = comoArreglo(e.programList?.program).map(texto).filter(Boolean);
    registros.push({
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
    });
  }
  // Un archivo vacío o con otro formato no debe reemplazar la lista vigente.
  if (!registros.length) throw new Error('El archivo de OFAC no trae registros de personas ni entidades');

  return {
    generadaEl: texto(raiz.publshInformation?.Publish_Date) || undefined,
    sha256: createHash('sha256').update(xml).digest('hex'),
    registros,
  };
}
