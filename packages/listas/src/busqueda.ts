import { similitudNombres } from './cotejo.js';
import { jaroWinkler, limpiar, tokensEntidad, tokensPersona } from './normalizar.js';
import type { RegistroLista } from './onu.js';

/**
 * Búsqueda libre en las listas cargadas (consulta del oficial o del
 * administrador). A diferencia del cotejo, no decide nada ni deja constancia
 * de una verificación: sirve para revisar a mano un nombre, alias, número de
 * referencia o documento. Es más permisiva que el cotejo (acepta un solo
 * apellido o parte del nombre) para no ocultar resultados.
 */
export type FuenteLista = 'onu' | 'designacion_1373' | 'ofac';

export interface ResultadoBusqueda {
  fuente: FuenteLista;
  registro: RegistroLista;
  motivo: 'referencia' | 'documento' | 'nombre';
  /** Nombre o alias que produjo el resultado. */
  nombreCoincidente: string;
  /** 0 a 1. */
  puntaje: number;
}

export interface OpcionesBusqueda {
  tipo?: 'individual' | 'entidad';
  /** Puntaje mínimo para mostrar un resultado por nombre. */
  umbral?: number;
  limite?: number;
}

/** Mínimo de caracteres útiles para buscar. */
export const MINIMO_BUSQUEDA = 3;

const compacto = (s: string) => limpiar(s).replace(/\s+/g, '');

/** Puntaje de un nombre del listado frente al texto buscado. */
function puntajeNombre(consulta: string, nombre: string, tipo: RegistroLista['tipo']): number {
  const tokens = tipo === 'individual' ? tokensPersona : tokensEntidad;
  const q = tokens(consulta);
  const t = tokens(nombre);
  if (!q.length || !t.length) return 0;
  const qLimpio = q.join(' ');
  const tLimpio = t.join(' ');
  if (qLimpio === tLimpio) return 1;
  // Una sola palabra (p. ej. un apellido): la similitud por nombre completo es
  // demasiado permisiva; se exige la palabra exacta o una muy parecida.
  let s = q.length === 1 ? Math.max(...t.map((u) => jaroWinkler(q[0], u))) * 0.9 : similitudNombres(q, t);
  // Parte del nombre (p. ej. un apellido o una palabra de la entidad): cuenta si
  // aparecen todas las palabras buscadas como palabras completas del listado.
  const palabras = new Set(t);
  if (q.every((p) => palabras.has(p))) s = Math.max(s, 0.85 + 0.15 * (q.length / t.length));
  return s;
}

export function buscarEnListas(
  texto: string,
  fuentes: { fuente: FuenteLista; registros: RegistroLista[] }[],
  opciones: OpcionesBusqueda = {},
): ResultadoBusqueda[] {
  const umbral = opciones.umbral ?? 0.82;
  const limite = opciones.limite ?? 50;
  const clave = compacto(texto);
  if (clave.length < MINIMO_BUSQUEDA) return [];

  const resultados: ResultadoBusqueda[] = [];
  for (const { fuente, registros } of fuentes) {
    for (const r of registros) {
      if (opciones.tipo && r.tipo !== opciones.tipo) continue;
      if (compacto(r.referencia) === clave) {
        resultados.push({ fuente, registro: r, motivo: 'referencia', nombreCoincidente: r.nombre, puntaje: 1 });
        continue;
      }
      if (clave.length >= 5 && /\d/.test(clave) && r.documentos.some((d) => compacto(d).includes(clave))) {
        resultados.push({ fuente, registro: r, motivo: 'documento', nombreCoincidente: r.nombre, puntaje: 1 });
        continue;
      }
      let mejor = 0;
      let nombreCoincidente = r.nombre;
      for (const n of [r.nombre, ...r.alias]) {
        const s = puntajeNombre(texto, n, r.tipo);
        if (s > mejor) { mejor = s; nombreCoincidente = n; }
      }
      if (mejor >= umbral) {
        resultados.push({ fuente, registro: r, motivo: 'nombre', nombreCoincidente, puntaje: Math.round(mejor * 1000) / 1000 });
      }
    }
  }
  return resultados.sort((a, b) => b.puntaje - a.puntaje || a.registro.nombre.localeCompare(b.registro.nombre)).slice(0, limite);
}
