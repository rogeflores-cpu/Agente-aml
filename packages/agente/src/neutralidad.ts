/**
 * Art. 38 del Decreto 15-2026: está prohibido revelar a terceros que se
 * examina una transacción, que se consultaron listas o que se comunicó
 * información a la IVE o a una autoridad. Todo texto que sale hacia el
 * cliente pasa por aquí antes de enviarse.
 */
const TERMINOS_RESERVADOS =
  /\b(onu|naciones unidas|sanci[oó]n\w*|alertas?|sospech\w*|rts|ive|intendencia|ministerio p[uú]blico|lavado|terroris\w*|pep|coincidencias?|inusual\w*|investigaci[oó]n\w*|bloque\w*|reportad\w*|congelad\w*|listas? (?:negras?|restrictivas?|de sancionados))\b/i;

export class TextoNoNeutral extends Error {}

export function terminoReservado(texto: string): string | null {
  return texto.match(TERMINOS_RESERVADOS)?.[0] ?? null;
}

export function verificarNeutralidad(texto: string): string {
  const t = terminoReservado(texto);
  if (t) throw new TextoNoNeutral(`Texto saliente contiene un término reservado: "${t}"`);
  return texto;
}
