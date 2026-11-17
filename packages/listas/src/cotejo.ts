import { jaroWinkler, limpiar, tokensEntidad, tokensPersona } from './normalizar.js';
import type { RegistroLista } from './onu.js';

export interface Consulta {
  nombre: string;
  tipo: 'individual' | 'entidad';
  /** AAAA-MM-DD, si se conoce. */
  fechaNacimiento?: string;
  nacionalidad?: string;
}

export interface Coincidencia {
  referencia: string;
  lista: string;
  nombreListado: string;
  /** Nombre o alias que produjo la coincidencia. */
  nombreCoincidente: string;
  puntaje: number;
  fechaNacimiento: 'coincide' | 'difiere' | 'sin_dato';
  prioridad: 'alta' | 'normal';
}

export interface OpcionesCotejo {
  /** Puntaje mínimo para reportar una posible coincidencia. */
  umbral: number;
  /** Similitud mínima para considerar que dos palabras coinciden. */
  umbralPalabra: number;
  maxResultados: number;
}

export const opcionesPorDefecto: OpcionesCotejo = { umbral: 0.88, umbralPalabra: 0.9, maxResultados: 10 };

/**
 * Similitud entre dos nombres por palabras, sin importar el orden.
 * Pondera más la dirección favorable (el listado suele traer menos palabras
 * que el nombre completo guatemalteco) y exige al menos dos palabras
 * coincidentes cuando ambos nombres tienen dos o más.
 */
export function similitudNombres(a: string[], b: string[], umbralPalabra = 0.9): number {
  if (!a.length || !b.length) return 0;
  const mejor = (x: string[], y: string[]) => x.map((t) => Math.max(...y.map((u) => jaroWinkler(t, u))));
  const ab = mejor(a, b);
  const ba = mejor(b, a);
  const promedio = (v: number[]) => v.reduce((s, n) => s + n, 0) / v.length;
  const sAB = promedio(ab);
  const sBA = promedio(ba);
  if (Math.min(a.length, b.length) >= 2) {
    const fuertes = Math.min(ab.filter((s) => s >= umbralPalabra).length, ba.filter((s) => s >= umbralPalabra).length);
    if (fuertes < 2) return Math.min(sAB, sBA) * 0.8;
  }
  return 0.7 * Math.max(sAB, sBA) + 0.3 * Math.min(sAB, sBA);
}

function compararFecha(consultada: string | undefined, registro: RegistroLista): Coincidencia['fechaNacimiento'] {
  if (!consultada || !registro.fechasNacimiento.length) return 'sin_dato';
  const anio = consultada.slice(0, 4);
  const iguala = registro.fechasNacimiento.some((f) => (f.length === 4 ? f === anio : f === consultada));
  return iguala ? 'coincide' : 'difiere';
}

/**
 * Coteja un nombre contra la lista. Nunca confirma ni descarta: entrega
 * posibles coincidencias para que el oficial de cumplimiento las disponga.
 */
export function cotejar(consulta: Consulta, lista: RegistroLista[], opciones: Partial<OpcionesCotejo> = {}): Coincidencia[] {
  const o = { ...opcionesPorDefecto, ...opciones };
  const tokens = consulta.tipo === 'individual' ? tokensPersona : tokensEntidad;
  const q = tokens(consulta.nombre);
  const qLimpio = q.join(' ');
  const resultados: Coincidencia[] = [];

  for (const r of lista) {
    if (r.tipo !== consulta.tipo) continue;
    let mejor = 0;
    let nombreCoincidente = r.nombre;
    for (const n of [r.nombre, ...r.alias]) {
      const t = tokens(n);
      const s = t.join(' ') === qLimpio ? 1 : similitudNombres(q, t, o.umbralPalabra);
      if (s > mejor) {
        mejor = s;
        nombreCoincidente = n;
      }
    }
    if (mejor < o.umbral) continue;
    const fecha = compararFecha(consulta.fechaNacimiento, r);
    resultados.push({
      referencia: r.referencia,
      lista: r.lista,
      nombreListado: r.nombre,
      nombreCoincidente,
      puntaje: Math.round(mejor * 1000) / 1000,
      fechaNacimiento: fecha,
      prioridad: mejor >= 0.97 || fecha === 'coincide' ? 'alta' : 'normal',
    });
  }
  return resultados.sort((x, y) => y.puntaje - x.puntaje).slice(0, o.maxResultados);
}

export { limpiar };
