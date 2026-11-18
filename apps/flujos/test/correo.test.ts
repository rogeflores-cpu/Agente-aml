import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  correoAvisoCumplimiento, correoCliente, correoDisponible, correoValido, enviarCorreo, textosFijosCorreo,
} from '../src/correo.js';
import { terminoReservado } from '@agente-aml/agente';

const entorno = { RESEND_API_KEY: 're_prueba', CORREO_REMITENTE: 'no-responder@amlconsultingguatemala.com' } as NodeJS.ProcessEnv;
const enlace = 'https://clientes.amlconsultingguatemala.com/casas-del-lago/e/' + 'a'.repeat(43);

afterEach(() => vi.unstubAllGlobals());

describe('correo al cliente', () => {
  it('art. 38: los textos fijos son neutros', () => {
    for (const t of textosFijosCorreo) expect(terminoReservado(t)).toBeNull();
  });

  it('lleva el nombre, la marca, el enlace y la fecha de vencimiento, y escapa el HTML', () => {
    const c = correoCliente('bienvenida', {
      nombre: 'Ana <script>alert(1)</script>', organizacion: 'Casas del Lago', enlace, venceEn: '2026-11-24T18:00:00Z', color: '#1d4ed8',
    });
    expect(c.asunto).toBe('Casas del Lago: complete la información de su operación');
    expect(c.texto).toContain(enlace);
    expect(c.texto).toContain('24 de noviembre de 2026');
    expect(c.html).toContain('&lt;script&gt;');
    expect(c.html).not.toContain('<script>');
    expect(c.html).toContain('#1d4ed8');
    // Un color inválido no se inyecta en el estilo
    expect(correoCliente('recordatorio', { nombre: 'Ana', organizacion: 'X', enlace, venceEn: '2026-11-24T18:00:00Z', color: 'red;}' }).html)
      .not.toContain('red;}');
  });

  it('valida direcciones', () => {
    expect(correoValido('cliente@example.com')).toBe(true);
    expect(correoValido('sin-arroba')).toBe(false);
    expect(correoValido('a@b.com, otro@b.com')).toBe(false);
    expect(correoValido(null)).toBe(false);
  });
});

describe('aviso a cumplimiento por correo', () => {
  it('no incluye datos del cliente: solo el asunto del aviso y el enlace a la consola', () => {
    const c = correoAvisoCumplimiento({
      organizacion: 'Casas del Lago', asuntoAviso: 'Quedan 4 horas del plazo del art. 43', prioridad: 'urgente',
      consola: 'https://consola.amlconsultingguatemala.com', expedienteId: '00000000-0000-0000-0000-0000000000e1',
    });
    expect(c.asunto).toBe('[URGENTE] Aviso de cumplimiento · Casas del Lago');
    expect(c.texto).toContain('https://consola.amlconsultingguatemala.com/?expediente=00000000-0000-0000-0000-0000000000e1');
    expect(c.texto).toContain('no incluye datos del cliente');
  });
});

describe('envío por Resend', () => {
  it('sin configuración el canal no está disponible', async () => {
    expect(correoDisponible({} as NodeJS.ProcessEnv)).toBe(false);
    expect(correoDisponible(entorno)).toBe(true);
    await expect(enviarCorreo({ para: 'a@b.com', asunto: 'x', texto: 'x', html: 'x', nombreRemitente: 'X' }, {} as NodeJS.ProcessEnv))
      .rejects.toThrow(/no está configurado/);
  });

  it('envía con la marca como remitente sin permitir romper la cabecera', async () => {
    const llamadas: any[] = [];
    vi.stubGlobal('fetch', async (url: string, init: any) => {
      llamadas.push({ url, init });
      return new Response(JSON.stringify({ id: 'email_123' }), { status: 200 });
    });
    const id = await enviarCorreo({
      para: 'cliente@example.com', asunto: 'Asunto', texto: 't', html: '<p>h</p>', nombreRemitente: 'Casas "del" <Lago>\r\nBcc: x@y.z',
    }, entorno);
    expect(id).toBe('email_123');
    expect(llamadas[0].url).toBe('https://api.resend.com/emails');
    expect(llamadas[0].init.headers.Authorization).toBe('Bearer re_prueba');
    const cuerpo = JSON.parse(llamadas[0].init.body);
    expect(cuerpo.from).toBe('Casas del Lago Bcc: x@y.z <no-responder@amlconsultingguatemala.com>');
    expect(cuerpo.to).toEqual(['cliente@example.com']);
  });

  it('un error del proveedor se informa', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"message":"domain not verified"}', { status: 403 }));
    await expect(enviarCorreo({ para: 'a@b.com', asunto: 'x', texto: 'x', html: 'x', nombreRemitente: 'X' }, entorno))
      .rejects.toThrow(/403/);
  });
});
