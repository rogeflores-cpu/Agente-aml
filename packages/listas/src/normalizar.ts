/** Partículas que no distinguen a una persona. */
const PARTICULAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'E', 'VDA', 'VIUDA']);

/** Formas societarias que no distinguen a una entidad. */
const FORMAS_SOCIETARIAS = new Set([
  'SA', 'SOCIEDAD', 'ANONIMA', 'LTDA', 'LIMITADA', 'LTD', 'LLC', 'INC', 'CORP', 'CORPORATION',
  'CO', 'COMPANY', 'CIA', 'COMPANIA', 'GMBH', 'AG', 'SRL', 'SAS', 'PLC', 'CV', 'DE', 'RL',
]);

/** Mayúsculas, sin tildes ni signos, espacios simples. */
export function limpiar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function tokensPersona(nombre: string): string[] {
  return limpiar(nombre)
    .split(' ')
    .filter((t) => t && !PARTICULAS.has(t));
}

export function tokensEntidad(nombre: string): string[] {
  // "S.A." llega como "S A": se unen las letras sueltas consecutivas antes de filtrar.
  const unidos = limpiar(nombre).replace(/\b([A-Z])\s(?=[A-Z]\b)/g, '$1');
  return unidos.split(' ').filter((t) => t && !FORMAS_SOCIETARIAS.has(t));
}

/** Similitud Jaro-Winkler entre dos cadenas (0 a 1). */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const rango = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const marcaA = new Array<boolean>(a.length).fill(false);
  const marcaB = new Array<boolean>(b.length).fill(false);
  let coincidencias = 0;
  for (let i = 0; i < a.length; i++) {
    const desde = Math.max(0, i - rango);
    const hasta = Math.min(i + rango + 1, b.length);
    for (let j = desde; j < hasta; j++) {
      if (marcaB[j] || a[i] !== b[j]) continue;
      marcaA[i] = marcaB[j] = true;
      coincidencias++;
      break;
    }
  }
  if (!coincidencias) return 0;
  let transposiciones = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!marcaA[i]) continue;
    while (!marcaB[k]) k++;
    if (a[i] !== b[k]) transposiciones++;
    k++;
  }
  const m = coincidencias;
  const jaro = (m / a.length + m / b.length + (m - transposiciones / 2) / m) / 3;
  let prefijo = 0;
  while (prefijo < Math.min(4, a.length, b.length) && a[prefijo] === b[prefijo]) prefijo++;
  return jaro + prefijo * 0.1 * (1 - jaro);
}
