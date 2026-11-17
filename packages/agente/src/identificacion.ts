import { limpiar } from '@agente-aml/listas';
import type { Contexto } from './catalogo.js';

/**
 * Personas que deben cotejarse con las listas del art. 43 y verificarse según
 * el art. 21 numerales 1 y 2: el cliente (o la entidad), quien actúa en su
 * nombre y los beneficiarios finales.
 */
export interface PersonaIdentificada {
  campo: string;
  rol: 'cliente' | 'entidad' | 'representante' | 'beneficiario_final';
  nombre: string;
  tipo: 'individual' | 'entidad';
  documento?: string;
  porcentaje?: number;
  controlPorOtroMedio?: boolean;
  fechaNacimiento?: string;
}

export interface BeneficiarioFinal {
  nombre: string;
  documento?: string;
  porcentaje?: number;
  controlPorOtroMedio?: boolean;
}

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * Interpreta la lista de beneficiarios finales. Acepta objetos
 * {nombre, documento, porcentaje, control_por_otro_medio} o cadenas como
 * "Ana Pérez, DPI 1234567890101, 30 %" (de ahí se toma solo el nombre).
 */
export function interpretarBeneficiarios(valor: unknown): BeneficiarioFinal[] {
  if (!Array.isArray(valor)) return [];
  const salida: BeneficiarioFinal[] = [];
  for (const item of valor) {
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      const nombre = texto(o.nombre);
      if (!nombre) continue;
      const pct = Number(String(o.porcentaje ?? '').replace(/[%\s]/g, '').replace(',', '.'));
      salida.push({
        nombre,
        documento: texto(o.documento) || undefined,
        porcentaje: Number.isFinite(pct) && String(o.porcentaje ?? '') !== '' ? pct : undefined,
        controlPorOtroMedio: o.control_por_otro_medio === true || o.controlPorOtroMedio === true,
      });
    } else if (typeof item === 'string' && item.trim()) {
      const partes = item.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
      const pct = item.match(/(\d{1,3}(?:[.,]\d+)?)\s*%/);
      const doc = item.match(/\b(\d[\d\s-]{6,}\d)\b/);
      salida.push({
        nombre: partes[0].replace(/\s*\d{1,3}(?:[.,]\d+)?\s*%.*$/, '').trim(),
        documento: doc ? doc[1].replace(/\D/g, '') : undefined,
        porcentaje: pct ? Number(pct[1].replace(',', '.')) : undefined,
      });
    }
  }
  return salida.filter((b) => b.nombre.length >= 3);
}

/** Todas las personas a identificar y cotejar según los datos del expediente. */
export function personasIdentificadas(contexto: Contexto, datos: Record<string, { valor: unknown }>): PersonaIdentificada[] {
  const v = (campo: string) => datos[campo]?.valor;
  const salida: PersonaIdentificada[] = [];
  if (contexto.tipoPersona === 'individual') {
    const nombre = texto(v('cliente.nombre_completo'));
    if (nombre) {
      salida.push({
        campo: 'cliente.nombre_completo', rol: 'cliente', nombre, tipo: 'individual',
        documento: texto(v('cliente.documento_numero')) || undefined,
        fechaNacimiento: texto(v('cliente.fecha_nacimiento')) || undefined,
      });
    }
  } else {
    const razon = texto(v('entidad.razon_social'));
    if (razon) salida.push({ campo: 'entidad.razon_social', rol: 'entidad', nombre: razon, tipo: 'entidad', documento: texto(v('entidad.nit')) || undefined });
    const rep = texto(v('representante.nombre_completo'));
    if (rep) salida.push({ campo: 'representante.nombre_completo', rol: 'representante', nombre: rep, tipo: 'individual', documento: texto(v('representante.documento_numero')) || undefined });
    for (const b of interpretarBeneficiarios(v('beneficiarios_finales'))) {
      salida.push({
        campo: 'beneficiarios_finales', rol: 'beneficiario_final', nombre: b.nombre,
        // Un beneficiario final puede ser a su vez una entidad (p. ej. "Holding ... Ltd.")
        tipo: /\b(s\.?\s?a\.?|ltd\.?|limited|llc|inc\.?|corp\.?|holding|sociedad|fundaci[oó]n|fideicomiso)\b/i.test(b.nombre) ? 'entidad' : 'individual',
        documento: b.documento, porcentaje: b.porcentaje, controlPorOtroMedio: b.controlPorOtroMedio,
      });
    }
  }
  return salida;
}

/** Clave estable de un nombre para saber si ya se cotejó (sin tildes, mayúsculas, orden ni signos). */
export function claveNombre(nombre: string): string {
  return limpiar(nombre).split(' ').filter(Boolean).sort().join(' ');
}
