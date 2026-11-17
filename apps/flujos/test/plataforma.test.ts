import { configuracionBaseInmobiliaria } from '@agente-aml/riesgo';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Base simulada: registra cada operación (tabla, acción, datos) y responde
 * con lo que defina cada prueba. Evita depender de Supabase.
 */
type Op = { tabla: string; accion: string; datos?: unknown; filtros: [string, unknown][] };
const registro: Op[] = [];
let responder: (op: Op) => { data: unknown; error: { message: string } | null } = () => ({ data: null, error: null });

function consulta(tabla: string) {
  const op: Op = { tabla, accion: 'select', filtros: [] };
  const resolver = () => { registro.push(op); return Promise.resolve(responder(op)); };
  const b: any = {
    select: () => b, order: () => b, limit: () => b, is: () => b,
    eq: (k: string, v: unknown) => { op.filtros.push([k, v]); return b; },
    insert: (d: unknown) => { op.accion = 'insert'; op.datos = d; return b; },
    update: (d: unknown) => { op.accion = 'update'; op.datos = d; return b; },
    upsert: (d: unknown) => { op.accion = 'upsert'; op.datos = d; return b; },
    single: resolver, maybeSingle: resolver,
    then: (ok: any, mal: any) => resolver().then(ok, mal),
  };
  return b;
}

const USUARIOS: Record<string, { id: string; email: string }> = {
  'token-admin': { id: 'u-admin', email: 'admin@plataforma.example' },
  'token-otro': { id: 'u-otro', email: 'oficial@inmobiliaria.example' },
};

vi.mock('../src/datos.js', () => ({
  db: () => ({
    auth: {
      getUser: async (t: string) => (USUARIOS[t] ? { data: { user: USUARIOS[t] }, error: null } : { data: { user: null }, error: { message: 'x' } }),
      admin: {
        inviteUserByEmail: async (correo: string) => ({ data: { user: { id: `nuevo-${correo}` } }, error: null }),
        getUserById: async () => ({ data: { user: null } }),
      },
    },
    from: consulta,
    rpc: (nombre: string, args: unknown) => {
      const op: Op = { tabla: `rpc:${nombre}`, accion: 'rpc', datos: args, filtros: [] };
      registro.push(op);
      return Promise.resolve(responder(op));
    },
  }),
  sinError: async (p: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    const { data, error } = await p;
    if (error) throw new Error(error.message);
    return data;
  },
}));

process.env.PLATAFORMA_ADMINS = 'admin@plataforma.example';
const { apiPlataforma, configuracionInicial, nitConFormato, nitVerificadorCorrecto, subdominioValido } = await import('../src/api-plataforma.js');

const pedir = (ruta: string, cuerpo?: unknown, token = 'token-admin', metodo = 'POST') =>
  apiPlataforma.request(ruta, {
    method: metodo,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });

const orgValida = {
  nombreLegal: 'Inmuebles del Valle, S.A.',
  nombreComercial: 'Inmuebles del Valle',
  nit: '1234567-8',
  subdominio: 'inmuebles-del-valle',
  marca: { nombreVisible: 'Inmuebles del Valle', colorPrimario: '#1d4ed8' },
};

beforeEach(() => {
  registro.length = 0;
  responder = () => ({ data: null, error: null });
});

describe('acceso', () => {
  it('rechaza sin sesión (401) y a quien no es administrador de la plataforma (403)', async () => {
    expect((await pedir('/organizaciones', undefined, '', 'GET')).status).toBe(401);
    expect((await pedir('/organizaciones', undefined, 'token-falso', 'GET')).status).toBe(401);
    expect((await pedir('/organizaciones', undefined, 'token-otro', 'GET')).status).toBe(403);
  });
});

describe('validaciones', () => {
  it('subdominio: formato y reservados', () => {
    expect(subdominioValido('inmuebles-del-valle')).toBe(true);
    expect(subdominioValido('ab')).toBe(false);
    expect(subdominioValido('Mayusculas')).toBe(false);
    expect(subdominioValido('-guion')).toBe(false);
    expect(subdominioValido('doble--guion')).toBe(false);
    expect(subdominioValido('consola')).toBe(false);
    expect(subdominioValido('www')).toBe(false);
  });

  it('NIT: formato y dígito verificador por módulo 11', () => {
    expect(nitConFormato('1234567-8')).toBe(true);
    expect(nitConFormato('576-K')).toBe(true);
    expect(nitConFormato('12A4567-8')).toBe(false);
    // 5·4 + 7·3 + 6·2 = 53; 53 mod 11 = 9; 11 − 9 = 2
    expect(nitVerificadorCorrecto('576-2')).toBe(true);
    expect(nitVerificadorCorrecto('576-3')).toBe(false);
    // 1·3 + 1·2 = 5; 11 − 5 = 6
    expect(nitVerificadorCorrecto('11-6')).toBe(true);
  });

  it('rechaza una organización con datos inválidos', async () => {
    const r = await pedir('/organizaciones', { ...orgValida, nit: 'abc', subdominio: 'api' });
    expect(r.status).toBe(400);
    const j = await r.json();
    expect(j.detalle.join(' ')).toMatch(/NIT/);
    expect(j.detalle.join(' ')).toMatch(/Subdominio/);
    expect(registro).toHaveLength(0);
  });
});

describe('alta de organización', () => {
  it('crea la organización y su metodología base SIN aprobar (art. 8)', async () => {
    responder = (op) => (op.tabla === 'organizaciones' && op.accion === 'insert' ? { data: { id: 'org-1' }, error: null } : { data: null, error: null });
    const r = await pedir('/organizaciones', orgValida);
    expect(r.status).toBe(201);
    const j = await r.json();
    expect(j.id).toBe('org-1');
    expect(j.advertencias.join(' ')).toMatch(/IVE/);
    const conf = registro.find((o) => o.tabla === 'configuraciones_riesgo' && o.accion === 'insert');
    expect(conf?.datos).toMatchObject({ organizacion_id: 'org-1', version: 1, aprobada_en: null, aprobada_por: null });
    expect((conf?.datos as any).parametros).toEqual(configuracionBaseInmobiliaria);
  });

  it('configuracionInicial nunca viene aprobada', () => {
    const f = configuracionInicial('x');
    expect(f.aprobada_en).toBeNull();
    expect(f.vigente_desde).toBeNull();
  });

  it('subdominio repetido devuelve 409', async () => {
    responder = (op) => (op.tabla === 'organizaciones' ? { data: null, error: { message: 'duplicate key value violates unique constraint' } } : { data: null, error: null });
    expect((await pedir('/organizaciones', orgValida)).status).toBe(409);
  });
});

describe('metodología', () => {
  it('la fecha de hoy se toma en hora de Guatemala', async () => {
    const { hoyGuatemala } = await import('../src/api-plataforma.js');
    // 03:30 UTC del 17 de noviembre = 21:30 del 16 de noviembre en Guatemala
    expect(hoyGuatemala(new Date('2026-11-17T03:30:00Z'))).toBe('2026-11-16');
  });

  it('exige órgano, acta y fecha no futura', async () => {
    const r = await pedir('/organizaciones/org-1/metodologia/aprobar', { organo: 'Consejo', fecha: '2999-01-01', acta: '' });
    expect(r.status).toBe(400);
  });

  it('aprueba la versión pendiente', async () => {
    responder = (op) => op.tabla === 'configuraciones_riesgo' && op.accion === 'select'
      ? { data: [{ id: 'c1', version: 1, parametros: configuracionBaseInmobiliaria, aprobada_en: null }], error: null }
      : { data: null, error: null };
    const r = await pedir('/organizaciones/org-1/metodologia/aprobar', { organo: 'Consejo de Administración', fecha: '2026-11-10', acta: 'Acta 15-2026' });
    expect(r.status).toBe(200);
    const upd = registro.find((o) => o.tabla === 'configuraciones_riesgo' && o.accion === 'update');
    expect(upd?.datos).toMatchObject({ aprobada_por: 'Consejo de Administración · Acta 15-2026', aprobada_en: '2026-11-10' });
  });

  it('sin versión pendiente pide parámetros para una versión nueva (409)', async () => {
    responder = (op) => op.tabla === 'configuraciones_riesgo'
      ? { data: [{ id: 'c1', version: 1, parametros: configuracionBaseInmobiliaria, aprobada_en: '2026-11-01' }], error: null }
      : { data: null, error: null };
    expect((await pedir('/organizaciones/org-1/metodologia/aprobar', { organo: 'Consejo', fecha: '2026-11-10', acta: '1' })).status).toBe(409);
  });

  it('una versión nueva que contradice la ley se rechaza', async () => {
    responder = (op) => op.tabla === 'configuraciones_riesgo' && op.accion === 'select'
      ? { data: [{ id: 'c1', version: 1, parametros: configuracionBaseInmobiliaria, aprobada_en: '2026-11-01' }], error: null }
      : { data: null, error: null };
    const r = await pedir('/organizaciones/org-1/metodologia/aprobar', {
      organo: 'Consejo', fecha: '2026-11-10', acta: '2',
      parametros: { ...configuracionBaseInmobiliaria, umbralEfectivoUsd: 20000 },
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/10,000/);
  });
});

describe('usuarios y WhatsApp', () => {
  it('invita por correo cuando el usuario no existe y lo agrega con su rol', async () => {
    responder = (op) => op.tabla === 'organizaciones' ? { data: { id: 'org-1', subdominio: 'x' }, error: null } : { data: null, error: null };
    const r = await pedir('/organizaciones/org-1/usuarios', { correo: 'Oficial@Ejemplo.com', rol: 'oficial' });
    expect(r.status).toBe(201);
    expect((await r.json()).invitado).toBe(true);
    const m = registro.find((o) => o.tabla === 'miembros');
    expect(m?.datos).toMatchObject({ organizacion_id: 'org-1', usuario_id: 'nuevo-oficial@ejemplo.com', rol: 'oficial', activo: true });
  });

  it('valida los datos del canal antes de tocar la base', async () => {
    const r = await pedir('/organizaciones/org-1/whatsapp', { wabaId: 'abc', phoneNumberId: '1', numeroVisible: '1', nombreVisible: 'x', token: 'corto' });
    expect(r.status).toBe(400);
    expect(registro).toHaveLength(0);
  });

  it('no conecta un número que ya pertenece a otra organización', async () => {
    responder = (op) =>
      op.tabla === 'organizaciones' ? { data: { id: 'org-1' }, error: null }
      : op.tabla === 'canales_whatsapp' ? { data: { organizacion_id: 'org-2' }, error: null }
      : { data: null, error: null };
    const r = await pedir('/organizaciones/org-1/whatsapp', {
      wabaId: '111', phoneNumberId: '222', numeroVisible: '+502 5555 0000', nombreVisible: 'Valle', token: 'x'.repeat(40),
    });
    expect(r.status).toBe(409);
    expect(registro.some((o) => o.tabla === 'rpc:guardar_token_canal')).toBe(false);
  });
});
