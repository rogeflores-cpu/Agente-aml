/**
 * Textos que recibe el cliente por WhatsApp o en el portal.
 *
 * Art. 38 del Decreto 15-2026: está prohibido revelar que se examina una
 * transacción, que se consultaron listas o que se reportó a la IVE. Todo texto
 * saliente pasa por verificarNeutralidad() antes de enviarse.
 */
export { verificarNeutralidad, TextoNoNeutral } from '@agente-aml/agente';

/**
 * Plantillas de WhatsApp. Cada sujeto obligado las aprueba en su cuenta de
 * Meta con estos nombres y el mismo orden de parámetros ({{1}}, {{2}}, ...).
 */
export const plantillasWhatsApp = {
  bienvenida: {
    nombre: 'aml_bienvenida_expediente',
    idioma: 'es',
    texto: 'Hola {{1}}. {{2}} le acompañará para completar la información de su operación. Ingrese aquí: {{3}}',
  },
  recordatorio: {
    nombre: 'aml_recordatorio_pendientes',
    idioma: 'es',
    texto: 'Hola {{1}}. Su expediente con {{2}} aún tiene información pendiente. Puede continuar aquí: {{3}}',
  },
  en_revision: {
    nombre: 'aml_expediente_en_revision',
    idioma: 'es',
    texto: 'Hola {{1}}. Recibimos su información. Su expediente con {{2}} está en revisión; le avisaremos si necesitamos algo más.',
  },
} as const;

export type ClavePlantilla = keyof typeof plantillasWhatsApp;

/** Estados que puede ver el cliente en el portal. Todos neutros. */
export const estadoParaCliente: Record<string, string> = {
  invitado: 'Pendiente de iniciar',
  en_captura: 'Información en proceso',
  en_revision: 'En revisión',
  listo_para_decision: 'En revisión',
  en_examen: 'En revisión',
  aprobado: 'Completado',
  aprobado_condicionado: 'Completado',
  rechazado: 'Finalizado',
  abstenido: 'Finalizado',
};

export const respuestas = {
  vinculado: 'Gracias. Su número quedó vinculado a su expediente. Por aquí puede enviar fotos de sus documentos y consultar lo que le falta.',
  codigoInvalido: 'El código no es válido o ya venció. Ingrese de nuevo al enlace para obtener uno nuevo.',
  noVinculado: 'Para continuar, ingrese al enlace que recibió y envíe por este medio el código de 6 dígitos que aparece en pantalla.',
  recibido: 'Recibido. Lo revisaremos y le indicaremos si falta algo.',
};
