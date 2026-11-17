import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PuertoExpediente, VistaCliente } from '@agente-aml/agente';
import {
  crearApiPortal,
  Limitador,
  origenPermitido,
  tipoReal,
  vistaSegura,
  type DependenciasPortal,
  type ExpedienteEnlace,
} from '../src/api-portal.js';

const TOKEN = 'a'.repeat(43);
const TOKEN_VENCIDO = 'b'.repeat(43);
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

const vista: VistaCliente = {
  nombreOrganizacion: 'Demo Inmuebles',
  nombreCliente: 'Cliente Ficticio',
  contexto: { parte: 'comprador', tipoPersona: 'individual' },
  estado: 'Información en proceso',
  datos: [{ campo: 'cliente.nombre_completo', valor: 'Cliente Ficticio', origen: 'cliente', confirmado: true }],
  documentos: [],
  pendientes: [
    { tipo: 'faltante', descripcion: 'DPI (ambos lados)' },
    { tipo: 'aclaracion', descripcion: 'Su nombre tuvo una coincidencia en la lista ONU' },
  ],
};

function dependencias(cambios: Partial<DependenciasPortal> = {}) {
  const enlaces: Record<string, ExpedienteEnlace> = {
    [hash(TOKEN)]: { expedienteId: 'exp-1', organizacionId: 'org-1', vigente: true, marca: { nombreVisible: 'Demo Inmuebles', colorPrimario: '#123456', logoUrl: null } },
    [hash(TOKEN_VENCIDO)]: { expedienteId: 'exp-2', organizacionId: 'org-1', vigente: false, marca: { nombreVisible: 'Demo', colorPrimario: '#123456', logoUrl: null } },
  };
  const puerto: PuertoExpediente = {
    vista: vi.fn(async () => vista),
    guardarDato: vi.fn(),
    confirmarDato: vi.fn(),
    enviarARevision: vi.fn(async () => ({ enviado: false, pendientes: ['DPI (ambos lados)'] })),
  };
  const mensajes: { direccion: string; texto: string }[] = [];
  const dep: DependenciasPortal & { mensajes: typeof mensajes } = {
    mensajes,
    buscarPorEnlace: vi.fn(async (h: string) => enlaces[h] ?? null),
    puerto: () => puerto,
    historial: vi.fn(async () => [{ rol: 'agente' as const, texto: 'Bienvenida' }]),
    guardarMensaje: vi.fn(async (_e, direccion, texto) => { mensajes.push({ direccion, texto }); }),
    atender: vi.fn(async () => ({ respuesta: 'Gracias. ¿Cuál es su estado civil?', acciones: [], respuestaReemplazada: false })),
    procesarDocumento: vi.fn(async () => ({ nota: 'Se leyó su DPI.' })),
    guardarCodigoWhatsapp: vi.fn(async () => '2026-11-16T18:30:00.000Z'),
    numeroWhatsapp: vi.fn(async () => '+502 5555 0000'),
    avisarReemplazo: vi.fn(async () => {}),
    ...cambios,
  };
  return dep;
}

const auth = (t = TOKEN) => ({ Authorization: `Enlace ${t}` });
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

describe('autenticación por enlace', () => {
  it('rechaza solicitudes sin token, con formato inválido o con token en la URL', async () => {
    const app = crearApiPortal(dependencias());
    expect((await app.request('/vista')).status).toBe(401);
    expect((await app.request('/vista', { headers: { Authorization: 'Enlace corto' } })).status).toBe(401);
    expect((await app.request(`/vista?token=${TOKEN}`)).status).toBe(401);
    expect((await app.request('/vista', { headers: { Authorization: `Bearer ${TOKEN}` } })).status).toBe(401);
  });

  it('rechaza un token desconocido sin revelar si existe', async () => {
    const app = crearApiPortal(dependencias());
    const r = await app.request('/vista', { headers: auth('c'.repeat(43)) });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: 'Enlace no válido' });
  });

  it('un enlace vencido responde 410', async () => {
    const r = await crearApiPortal(dependencias()).request('/vista', { headers: auth(TOKEN_VENCIDO) });
    expect(r.status).toBe(410);
  });

  it('busca por el hash SHA-256 del token, nunca por el token', async () => {
    const dep = dependencias();
    await crearApiPortal(dep).request('/vista', { headers: auth() });
    expect(dep.buscarPorEnlace).toHaveBeenCalledWith(hash(TOKEN));
  });

  it('limita las solicitudes por token', async () => {
    const app = crearApiPortal(dependencias(), { limiteMinuto: 2 });
    expect((await app.request('/vista', { headers: auth() })).status).toBe(200);
    expect((await app.request('/vista', { headers: auth() })).status).toBe(200);
    expect((await app.request('/vista', { headers: auth() })).status).toBe(429);
  });
});

describe('art. 38: lo que ve el cliente', () => {
  it('la vista no incluye el contexto interno y sustituye textos reservados', async () => {
    const r = await crearApiPortal(dependencias()).request('/vista', { headers: auth() });
    const json = await r.json();
    expect(json.marca.colorPrimario).toBe('#123456');
    expect(json.vista.contexto).toBeUndefined();
    expect(JSON.stringify(json)).not.toMatch(/ONU|coincidencia/i);
    expect(json.vista.pendientes).toHaveLength(2);
  });

  it('vistaSegura neutraliza un estado no neutro', () => {
    expect(vistaSegura({ ...vista, estado: 'En examen por alerta' }).estado).toBe('En revisión');
  });

  it('si el agente produjo un texto reservado, se avisa a cumplimiento', async () => {
    const dep = dependencias({
      atender: vi.fn(async () => ({ respuesta: 'Gracias. Estamos revisando su información.', acciones: [], respuestaReemplazada: true })),
    });
    await crearApiPortal(dep).request('/mensaje', { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: '¿Por qué tarda?' }) });
    expect(dep.avisarReemplazo).toHaveBeenCalledOnce();
  });

  it('los errores internos llegan al cliente como mensaje genérico', async () => {
    const dep = dependencias({ atender: vi.fn(async () => { throw new Error('relation aml.verificaciones does not exist'); }) });
    const r = await crearApiPortal(dep).request('/mensaje', { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: 'Hola' }) });
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/verificaciones|aml\./);
  });
});

describe('conversación', () => {
  it('guarda el mensaje del cliente y la respuesta del agente en canal web', async () => {
    const dep = dependencias();
    const r = await crearApiPortal(dep).request('/mensaje', {
      method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: 'Soy casada' }),
    });
    expect((await r.json()).respuesta).toMatch(/estado civil/);
    expect(dep.mensajes.map((m) => m.direccion)).toEqual(['entrante', 'saliente']);
    expect((dep.atender as any).mock.calls[0][1].canal).toBe('web');
  });

  it('rechaza mensajes vacíos o demasiado largos', async () => {
    const app = crearApiPortal(dependencias());
    const enviar = (texto: string) => app.request('/mensaje', { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ texto }) });
    expect((await enviar('   ')).status).toBe(400);
    expect((await enviar('x'.repeat(2001))).status).toBe(400);
  });
});

describe('documentos', () => {
  const subir = (app: ReturnType<typeof crearApiPortal>, bytes: Uint8Array, nombre = 'dpi.jpg', tipo = 'image/jpeg') => {
    const fd = new FormData();
    fd.append('archivo', new File([bytes as Uint8Array<ArrayBuffer>], nombre, { type: tipo }));
    return app.request('/documento', { method: 'POST', headers: auth(), body: fd });
  };

  it('identifica el formato por su contenido, no por la extensión', () => {
    expect(tipoReal(JPEG)).toBe('image/jpeg');
    expect(tipoReal(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
    expect(tipoReal(new TextEncoder().encode('%PDF-1.7'))).toBe('application/pdf');
    expect(tipoReal(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8'))).toBe('image/webp');
    expect(tipoReal(new TextEncoder().encode('<html>'))).toBeNull();
  });

  it('acepta una foto válida, la procesa y responde con el agente', async () => {
    const dep = dependencias();
    const r = await subir(crearApiPortal(dep), JPEG);
    expect(r.status).toBe(200);
    expect(dep.procesarDocumento).toHaveBeenCalledWith('exp-1', expect.objectContaining({ mime: 'image/jpeg' }));
    // M5: la nota de la plataforma viaja en un campo propio, no mezclada con el texto del cliente
    expect((dep.atender as any).mock.calls[0][1].nota).toBeTruthy();
    expect((dep.atender as any).mock.calls[0][1].mensaje).not.toMatch(/Nota del sistema/);
  });

  it('rechaza un archivo que dice ser imagen pero no lo es', async () => {
    const dep = dependencias();
    const r = await subir(crearApiPortal(dep), new TextEncoder().encode('<script>alert(1)</script>'), 'dpi.jpg');
    expect(r.status).toBe(415);
    expect(dep.procesarDocumento).not.toHaveBeenCalled();
  });

  it('rechaza archivos de más de 10 MB', async () => {
    const grande = new Uint8Array(10 * 1024 * 1024 + 1);
    grande.set(JPEG);
    const r = await subir(crearApiPortal(dependencias()), grande);
    expect(r.status).toBe(413);
  });

  it('rechaza archivos vacíos o ausentes', async () => {
    const app = crearApiPortal(dependencias());
    expect((await subir(app, new Uint8Array(0))).status).toBe(400);
    expect((await app.request('/documento', { method: 'POST', headers: auth(), body: new FormData() })).status).toBe(400);
  });
});

describe('vinculación con WhatsApp y envío a revisión', () => {
  it('genera un código de 6 dígitos y lo fija con la función de la base (hash con el expediente)', async () => {
    const dep = dependencias();
    const r = await crearApiPortal(dep).request('/codigo-whatsapp', { method: 'POST', headers: auth() });
    const json = await r.json();
    expect(json.codigo).toMatch(/^\d{6}$/);
    expect(json.enlaceWhatsapp).toBe(`https://wa.me/50255550000?text=${json.codigo}`);
    const [expedienteId, codigo, minutos] = (dep.guardarCodigoWhatsapp as any).mock.calls[0];
    expect(codigo).toBe(json.codigo);
    expect(minutos).toBe(30);
    expect(typeof expedienteId).toBe('string');
    // el vencimiento que se muestra es el que fijó la base
    expect(json.expiraEn).toBe('2026-11-16T18:30:00.000Z');
  });

  it('sin canal de WhatsApp activo, el portal sigue siendo el único canal', async () => {
    const r = await crearApiPortal(dependencias({ numeroWhatsapp: vi.fn(async () => null) })).request('/codigo-whatsapp', { method: 'POST', headers: auth() });
    expect(r.status).toBe(409);
  });

  it('enviar a revisión devuelve los pendientes si los hay', async () => {
    const r = await crearApiPortal(dependencias()).request('/enviar-a-revision', { method: 'POST', headers: auth() });
    expect(await r.json()).toEqual({ enviado: false, pendientes: ['DPI (ambos lados)'] });
  });
});

describe('utilidades', () => {
  it('CORS: subdominios de la plataforma y localhost', () => {
    expect(origenPermitido('https://demo-inmuebles.agenteaml.example', 'agenteaml.example')).toBe(true);
    expect(origenPermitido('http://localhost:5174', 'agenteaml.example')).toBe(true);
    expect(origenPermitido('https://agenteaml.example.atacante.com', 'agenteaml.example')).toBe(false);
    expect(origenPermitido('https://x.otro.example', 'agenteaml.example')).toBe(false);
    expect(origenPermitido('http://demo.agenteaml.example', 'agenteaml.example')).toBe(false);
  });

  it('el limitador libera la ventana con el tiempo', () => {
    const l = new Limitador(1, 1000);
    expect(l.permitir('k', 0)).toBe(true);
    expect(l.permitir('k', 500)).toBe(false);
    expect(l.permitir('k', 1500)).toBe(true);
  });
});
