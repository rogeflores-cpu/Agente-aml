/**
 * Art. 38 del Decreto 15-2026: está prohibido revelar a terceros "el hecho
 * que se está examinando alguna transacción", que se consultaron listas o que
 * se comunicó información a la IVE o a una autoridad. Todo texto que sale
 * hacia el cliente pasa por aquí antes de enviarse.
 */
const TERMINOS_RESERVADOS = new RegExp(
  [
    // Listas y designaciones (art. 43)
    'onu', 'naciones unidas', 'consejo de seguridad', 'ofac', 'gafi',
    'listas? (?:negras?|restrictivas?|de sancionados|internacionales|de control)',
    'sanci[oó]n\\w*', 'sancionad\\w*', 'designad[oa]s? en', 'coincidencias?',
    // Autoridades y reportes (arts. 30, 33, 38)
    'ive', 'intendencia', 'superintendencia', 'uif', 'ministerio p[uú]blico', 'fiscal[ií]a\\w*',
    'rts', 'report(?:e|es|ado|ada|ados|adas|ar|aremos|amos)\\b', 'denunci\\w*', 'autoridad(?:es)? competentes?',
    // Examen y transacciones inusuales (arts. 29 y 38)
    'examen\\w*', 'examina\\w*', 'inusual\\w*', 'sospech\\w*', 'investigaci[oó]n\\w*', 'investigand\\w*',
    // Medidas sobre fondos (art. 43)
    'bloque\\w*', 'congel\\w*', 'retenci[oó]n de (?:fondos|activos)', 'limitaci[oó]n (?:preventiva|con efecto preventivo)',
    // Riesgo y PEP
    'pep', 'peps', 'expuest[ao]s? pol[ií]ticamente', 'nivel de riesgo', 'riesgo (?:alto|medio|bajo)', 'alto riesgo',
    'alertas?', 'lavado', 'terroris\\w*', 'financiamiento del terrorismo',
  ]
    .map((t) => `(?:${t})`)
    .join('|')
    .replace(/^/, '\\b(?:')
    .concat(')\\b'),
  'i',
);

export class TextoNoNeutral extends Error {}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Devuelve el primer término reservado del texto, o null.
 * `excluir`: nombres propios (del cliente o de la organización) que pueden
 * contener por casualidad una palabra reservada (p. ej. "Pep", "Ive") y que
 * no deben bloquear el mensaje.
 */
export function terminoReservado(texto: string, excluir: (string | null | undefined)[] = []): string | null {
  let limpio = texto;
  for (const nombre of excluir) {
    if (!nombre || nombre.trim().length < 2) continue;
    limpio = limpio.replace(new RegExp(escapar(nombre.trim()), 'gi'), ' ');
    // También cada palabra del nombre por separado ("Pep" de "Pep Ruiz")
    for (const palabra of nombre.trim().split(/\s+/)) {
      if (palabra.length >= 2) limpio = limpio.replace(new RegExp(`\\b${escapar(palabra)}\\b`, 'gi'), ' ');
    }
  }
  return limpio.match(TERMINOS_RESERVADOS)?.[0] ?? null;
}

export function verificarNeutralidad(texto: string, excluir: (string | null | undefined)[] = []): string {
  const t = terminoReservado(texto, excluir);
  if (t) throw new TextoNoNeutral(`Texto saliente contiene un término reservado: "${t}"`);
  return texto;
}
