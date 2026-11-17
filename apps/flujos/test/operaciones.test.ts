import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.INNGEST_DEV = '1';
});

const operacionValida = {
  organizacionId: '3f1c2a4e-8b7d-4c6a-9e2f-1a2b3c4d5e6f',
  tipo: 'compraventa',
  inmueble: { departamento: 'Guatemala', municipio: 'Mixco' },
  precio: 900000,
  moneda: 'GTQ',
  formaPago: [{ medio: 'financiamiento_bancario', monto: 720000, pagador: 'cliente' }, { medio: 'efectivo', monto: 180000, pagador: 'cliente' }],
  partes: [
    { parte: 'comprador', tipoPersona: 'individual', nombre: 'Comprador Ficticio', telefono: '+50255550001' },
    { parte: 'vendedor', tipoPersona: 'juridica', nombre: 'Vendedora Ficticia, S.A.', correo: 'v@example.com' },
  ],
};

describe('API de operaciones', () => {
  it('rechaza solicitudes sin sesión', async () => {
    const { apiOperaciones } = await import('../src/api-operaciones.js');
    const app = new Hono().route('/api/operaciones', apiOperaciones);
    for (const [metodo, ruta] of [
      ['POST', '/api/operaciones/operaciones'],
      ['POST', '/api/operaciones/expedientes/x/reenviar-enlace'],
      ['POST', '/api/operaciones/pagos-efectivo'],
    ]) {
      const r = await app.request(ruta, { method: metodo, body: '{}' });
      expect(r.status).toBe(401);
    }
  });

  it('permite el origen de la consola y no otros (CORS)', async () => {
    const { apiOperaciones } = await import('../src/api-operaciones.js');
    const app = new Hono().route('/api/operaciones', apiOperaciones);
    const ok = await app.request('/api/operaciones/operaciones', {
      method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' },
    });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const no = await app.request('/api/operaciones/operaciones', {
      method: 'OPTIONS', headers: { Origin: 'https://otro.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(no.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('validación de operaciones', () => {
  it('acepta una operación completa', async () => {
    const { esquemaOperacion } = await import('../src/api-operaciones.js');
    expect(esquemaOperacion.safeParse(operacionValida).success).toBe(true);
  });

  it('exige teléfono internacional o correo en cada parte', async () => {
    const { esquemaOperacion } = await import('../src/api-operaciones.js');
    const sinContacto = { ...operacionValida, partes: [{ parte: 'comprador', tipoPersona: 'individual', nombre: 'Sin Contacto' }] };
    expect(esquemaOperacion.safeParse(sinContacto).success).toBe(false);
    const telefonoLocal = { ...operacionValida, partes: [{ parte: 'comprador', tipoPersona: 'individual', nombre: 'Tel Local', telefono: '55550001' }] };
    expect(esquemaOperacion.safeParse(telefonoLocal).success).toBe(false);
  });

  it('rechaza operaciones sin partes, medios desconocidos o pagos mayores al precio', async () => {
    const { esquemaOperacion } = await import('../src/api-operaciones.js');
    expect(esquemaOperacion.safeParse({ ...operacionValida, partes: [] }).success).toBe(false);
    expect(esquemaOperacion.safeParse({ ...operacionValida, formaPago: [{ medio: 'trueque', monto: 10, pagador: 'cliente' }] }).success).toBe(false);
    expect(esquemaOperacion.safeParse({ ...operacionValida, formaPago: [{ medio: 'efectivo', monto: 950000, pagador: 'cliente' }] }).success).toBe(false);
  });

  it('pagos en efectivo: fecha no futura, montos y tipo de cambio positivos', async () => {
    const { esquemaPagoEfectivo } = await import('../src/api-operaciones.js');
    const base = { expedienteId: '7a9b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d', fecha: '2026-11-16', monto: 40000, moneda: 'GTQ', tipoCambioUsd: 7.7 };
    expect(esquemaPagoEfectivo.safeParse(base).success).toBe(true);
    expect(esquemaPagoEfectivo.safeParse({ ...base, fecha: '2999-01-01' }).success).toBe(false);
    expect(esquemaPagoEfectivo.safeParse({ ...base, monto: 0 }).success).toBe(false);
    expect(esquemaPagoEfectivo.safeParse({ ...base, tipoCambioUsd: -1 }).success).toBe(false);
    expect(esquemaPagoEfectivo.safeParse({ ...base, moneda: 'quetzal' }).success).toBe(false);
  });
});
