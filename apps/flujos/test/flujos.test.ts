import { createHmac } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { nuevoCodigoVinculacion, nuevoEnlace, sha256 } from '../src/enlaces.js';
import {
  estadoParaCliente,
  plantillasWhatsApp,
  respuestas,
  TextoNoNeutral,
  verificarNeutralidad,
} from '../src/plantillas.js';
import { extraerMensajes, firmaValida } from '../src/whatsapp.js';

beforeAll(() => {
  process.env.META_APP_SECRET = 'secreto-de-prueba';
  process.env.META_VERIFY_TOKEN = 'verificar-123';
  process.env.INNGEST_DEV = '1';
});

const firmar = (cuerpo: string, secreto = 'secreto-de-prueba') =>
  'sha256=' + createHmac('sha256', secreto).update(cuerpo).digest('hex');

const webhook = {
  object: 'whatsapp_business_account',
  entry: [{
    id: 'WABA1',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '50255550000', phone_number_id: 'PNID-A1' },
        messages: [
          { from: '50255550001', id: 'wamid.1', timestamp: '1762900000', type: 'text', text: { body: '482913' } },
          { from: '50255550001', id: 'wamid.2', timestamp: '1762900060', type: 'image', image: { id: 'MEDIA1', caption: 'DPI frente' } },
        ],
        statuses: [{ id: 'wamid.0', status: 'delivered' }],
      },
    }],
  }],
};

describe('art. 38: textos al cliente siempre neutros', () => {
  it('todas las plantillas, respuestas y estados pasan la verificación', () => {
    for (const p of Object.values(plantillasWhatsApp)) expect(() => verificarNeutralidad(p.texto)).not.toThrow();
    for (const r of Object.values(respuestas)) expect(() => verificarNeutralidad(r)).not.toThrow();
    for (const e of Object.values(estadoParaCliente)) expect(() => verificarNeutralidad(e)).not.toThrow();
  });

  it('el estado de examen se muestra al cliente igual que una revisión normal', () => {
    expect(estadoParaCliente.en_examen).toBe(estadoParaCliente.en_revision);
  });

  it.each([
    'Su nombre aparece en la lista de la ONU',
    'Detectamos una coincidencia en las listas',
    'Su operación fue reportada a la IVE',
    'Tenemos una alerta sobre su expediente',
    'Su caso está bajo investigación',
    'Usted es PEP',
    'Operación sospechosa',
  ])('bloquea: "%s"', (texto) => {
    expect(() => verificarNeutralidad(texto)).toThrow(TextoNoNeutral);
  });
});

describe('webhook de WhatsApp', () => {
  it('valida la firma de Meta', () => {
    const cuerpo = JSON.stringify(webhook);
    expect(firmaValida(cuerpo, firmar(cuerpo), 'secreto-de-prueba')).toBe(true);
    expect(firmaValida(cuerpo, firmar(cuerpo, 'otro'), 'secreto-de-prueba')).toBe(false);
    expect(firmaValida(cuerpo + ' ', firmar(cuerpo), 'secreto-de-prueba')).toBe(false);
    expect(firmaValida(cuerpo, undefined, 'secreto-de-prueba')).toBe(false);
  });

  it('extrae texto y documentos, e ignora estados de entrega', () => {
    const m = extraerMensajes(webhook);
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ phoneNumberId: 'PNID-A1', waId: '50255550001', tipo: 'text', texto: '482913' });
    expect(m[1]).toMatchObject({ tipo: 'image', mediaId: 'MEDIA1', texto: 'DPI frente' });
  });

  it('el servidor rechaza firmas inválidas y encola los mensajes válidos', async () => {
    const { app } = await import('../src/servidor.js');
    const { inngest } = await import('../src/cliente-inngest.js');
    const enviar = vi.spyOn(inngest, 'send').mockResolvedValue({ ids: [] } as any);
    const cuerpo = JSON.stringify(webhook);

    const malo = await app.request('/webhooks/whatsapp', { method: 'POST', body: cuerpo, headers: { 'x-hub-signature-256': firmar(cuerpo, 'x') } });
    expect(malo.status).toBe(401);
    expect(enviar).not.toHaveBeenCalled();

    const bueno = await app.request('/webhooks/whatsapp', { method: 'POST', body: cuerpo, headers: { 'x-hub-signature-256': firmar(cuerpo) } });
    expect(bueno.status).toBe(200);
    expect(enviar).toHaveBeenCalledOnce();
    expect((enviar.mock.calls[0][0] as any[]).map((e) => e.id)).toEqual(['wamid.1', 'wamid.2']);
  });

  it('responde la verificación de suscripción solo con el token correcto', async () => {
    const { app } = await import('../src/servidor.js');
    const ok = await app.request('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verificar-123&hub.challenge=abc');
    expect(await ok.text()).toBe('abc');
    const no = await app.request('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=abc');
    expect(no.status).toBe(403);
  });
});

describe('enlaces y códigos', () => {
  it('el enlace lleva la marca de la organización y solo se guarda el hash', () => {
    const e = nuevoEnlace('demo-inmuebles', 'agenteaml.example', 7, new Date('2026-11-11T12:00:00Z'));
    expect(e.url).toMatch(/^https:\/\/agenteaml\.example\/demo-inmuebles\/e\/[\w-]{43}$/);
    expect(e.tokenHash).toBe(sha256(e.url.split('/e/')[1]));
    expect(e.expiraEn).toBe('2026-11-18T12:00:00.000Z');
  });

  it('el código de vinculación tiene 6 dígitos y vence en 30 minutos', () => {
    const c = nuevoCodigoVinculacion(new Date('2026-11-11T12:00:00Z'));
    expect(c.codigo).toMatch(/^\d{6}$/);
    expect(c.hash).toBe(sha256(c.codigo));
    expect(c.expiraEn).toBe('2026-11-11T12:30:00.000Z');
  });
});
