/** Validaciones de la interfaz. Repiten las del servidor para dar aviso inmediato. */
const RESERVADOS = new Set(['www', 'api', 'app', 'admin', 'consola', 'plataforma', 'portal', 'flujos', 'mail', 'correo', 'soporte', 'ayuda', 'demo', 'static']);

export const subdominioValido = (s: string) =>
  /^[a-z0-9]([a-z0-9-]{1,40}[a-z0-9])$/.test(s) && !s.includes('--') && !RESERVADOS.has(s);

export const nitConFormato = (nit: string) => /^\d{1,12}-?[\dK]$/i.test(nit.trim());

export function nitVerificadorCorrecto(nit: string): boolean {
  const limpio = nit.trim().toUpperCase().replace(/-/g, '');
  if (!/^\d{1,12}[\dK]$/.test(limpio)) return false;
  const cuerpo = limpio.slice(0, -1);
  let suma = 0;
  for (let i = 0; i < cuerpo.length; i++) suma += Number(cuerpo[i]) * (cuerpo.length + 1 - i);
  const r = (11 - (suma % 11)) % 11;
  return (r === 10 ? 'K' : String(r)) === limpio.slice(-1);
}

/** Sugerencia de subdominio a partir del nombre comercial. */
export const sugerirSubdominio = (nombre: string) =>
  nombre.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-').slice(0, 42);

/** Códigos ISO 3166-1 alfa-2 separados por comas o espacios. Devuelve los válidos y los inválidos. */
export function leerCodigosIso(texto: string): { validos: string[]; invalidos: string[] } {
  const partes = texto.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
  const validos = [...new Set(partes.filter((p) => /^[A-Z]{2}$/.test(p)))];
  return { validos, invalidos: partes.filter((p) => !/^[A-Z]{2}$/.test(p)) };
}

export const colorValido = (c: string) => /^#[0-9a-fA-F]{6}$/.test(c);
export const correoValido = (c: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.trim());

/** Fecha de hoy en Guatemala (AAAA-MM-DD). */
export const hoyLocal = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Guatemala' });
