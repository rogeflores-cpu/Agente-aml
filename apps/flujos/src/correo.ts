import { verificarNeutralidad } from '@agente-aml/agente';

/**
 * Correo electrónico (Resend): canal para los enlaces del cliente mientras no
 * haya WhatsApp y para los avisos urgentes a cumplimiento.
 *
 * Variables: RESEND_API_KEY y CORREO_REMITENTE (p. ej.
 * no-responder@amlconsultingguatemala.com, dominio verificado en Resend).
 * Sin ellas el canal no está disponible y el sistema sigue con el siguiente.
 */
export interface Correo {
  para: string;
  asunto: string;
  texto: string;
  html: string;
  /** Nombre visible del remitente (la marca de la inmobiliaria). */
  nombreRemitente: string;
  responderA?: string;
}

export const correoDisponible = (entorno: NodeJS.ProcessEnv = process.env) =>
  !!entorno.RESEND_API_KEY && !!entorno.CORREO_REMITENTE;

export const correoValido = (c: string | null | undefined): c is string =>
  !!c && /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}$/i.test(c.trim());

const escapar = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Nombre del remitente sin caracteres que rompan la cabecera From. */
const limpiarNombre = (s: string) =>
  s.replace(/[\r\n\t]+/g, ' ').replace(/["<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Notificaciones';

/** Envía un correo y devuelve el id del proveedor. Lanza error si falla. */
export async function enviarCorreo(c: Correo, entorno: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (!correoDisponible(entorno)) throw new Error('El correo no está configurado (RESEND_API_KEY, CORREO_REMITENTE)');
  if (!correoValido(c.para)) throw new Error('Dirección de correo inválida');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${entorno.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${limpiarNombre(c.nombreRemitente)} <${entorno.CORREO_REMITENTE}>`,
      to: [c.para.trim()],
      subject: c.asunto,
      text: c.texto,
      html: c.html,
      ...(c.responderA && correoValido(c.responderA) ? { reply_to: c.responderA } : {}),
    }),
  });
  const cuerpo = await r.text();
  if (!r.ok) throw new Error(`Resend respondió ${r.status}: ${cuerpo.slice(0, 200)}`);
  try { return (JSON.parse(cuerpo) as { id?: string }).id ?? null; } catch { return null; }
}

// ------------------------------------------------------------------ cliente

/**
 * Correos al cliente. Igual que las plantillas de WhatsApp: el texto fijo pasa
 * por la regla del art. 38 (verificarNeutralidad) y los parámetros son solo el
 * nombre del cliente, el de la inmobiliaria y el enlace.
 */
const TEXTOS_CLIENTE = {
  bienvenida: {
    asunto: '{{2}}: complete la información de su operación',
    parrafo: '{{2}} le acompañará para completar la información de su operación. Puede hacerlo desde su teléfono o computadora, a su ritmo, en este enlace personal:',
    boton: 'Completar mi información',
  },
  recordatorio: {
    asunto: '{{2}}: su información aún está pendiente',
    parrafo: 'Su expediente con {{2}} aún tiene información pendiente. Puede continuar donde se quedó en este enlace personal:',
    boton: 'Continuar',
  },
} as const;

export type PlantillaCorreo = keyof typeof TEXTOS_CLIENTE;

/** Textos fijos (sin parámetros), para probarlos con la regla del art. 38. */
export const textosFijosCorreo = Object.values(TEXTOS_CLIENTE).flatMap((t) => [t.asunto, t.parrafo, t.boton]);

export function correoCliente(
  plantilla: PlantillaCorreo,
  p: { nombre: string; organizacion: string; enlace: string; venceEn: string; color?: string },
): Omit<Correo, 'para' | 'nombreRemitente'> {
  const t = TEXTOS_CLIENTE[plantilla];
  for (const fijo of [t.asunto, t.parrafo, t.boton]) verificarNeutralidad(fijo);
  const llenar = (s: string) => s.replace('{{2}}', p.organizacion);
  const vence = new Date(p.venceEn).toLocaleDateString('es-GT', { timeZone: 'America/Guatemala', day: 'numeric', month: 'long', year: 'numeric' });
  const color = /^#[0-9a-f]{6}$/i.test(p.color ?? '') ? p.color! : '#0f5e5a';
  const asunto = llenar(t.asunto);
  const parrafo = llenar(t.parrafo);
  const pie = `El enlace es personal y vence el ${vence}. Si no esperaba este mensaje, puede ignorarlo.`;
  const texto = `Hola ${p.nombre}:\n\n${parrafo}\n\n${p.enlace}\n\n${pie}\n\n${p.organizacion}`;
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e7e5e4">
<tr><td style="padding:20px 24px;border-bottom:4px solid ${color};font-size:18px;font-weight:bold">${escapar(p.organizacion)}</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.6">
<p style="margin:0 0 12px">Hola ${escapar(p.nombre)}:</p>
<p style="margin:0 0 20px">${escapar(parrafo)}</p>
<p style="margin:0 0 20px"><a href="${escapar(p.enlace)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">${escapar(t.boton)}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#57534e">Si el botón no funciona, copie esta dirección en su navegador:<br><span style="word-break:break-all">${escapar(p.enlace)}</span></p>
<p style="margin:16px 0 0;font-size:13px;color:#57534e">${escapar(pie)}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { asunto, texto, html };
}

// --------------------------------------------------------- cumplimiento

/**
 * Aviso a cumplimiento por correo. Por seguridad no lleva datos del cliente
 * (nombres, montos ni el detalle del aviso): solo el asunto genérico del aviso
 * y el enlace a la consola, donde se consulta con sesión.
 */
export function correoAvisoCumplimiento(p: {
  organizacion: string; asuntoAviso: string; prioridad: 'alta' | 'urgente'; consola: string; expedienteId?: string;
}): Omit<Correo, 'para' | 'nombreRemitente'> {
  const etiqueta = p.prioridad === 'urgente' ? 'URGENTE' : 'Prioridad alta';
  const asunto = `[${etiqueta}] Aviso de cumplimiento · ${p.organizacion}`;
  const enlace = p.consola.replace(/\/$/, '') + (p.expedienteId ? `/?expediente=${encodeURIComponent(p.expedienteId)}` : '/');
  const texto = `Tiene un aviso en la consola de cumplimiento de ${p.organizacion}:\n\n${p.asuntoAviso}\n\n`
    + `Ingrese a la consola para ver el detalle: ${enlace}\n\n`
    + 'Por seguridad, este correo no incluye datos del cliente. No lo reenvíe.';
  const html = `<!doctype html><html lang="es"><body style="font-family:Arial,Helvetica,sans-serif;color:#1c1917;line-height:1.6">
<p><strong>${escapar(etiqueta)}</strong> · ${escapar(p.organizacion)}</p>
<p>${escapar(p.asuntoAviso)}</p>
<p><a href="${escapar(enlace)}">Ver el detalle en la consola de cumplimiento</a></p>
<p style="font-size:13px;color:#57534e">Por seguridad, este correo no incluye datos del cliente. No lo reenvíe.</p>
</body></html>`;
  return { asunto, texto, html };
}
