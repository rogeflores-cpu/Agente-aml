import { beforeAll, describe, expect, it } from 'vitest';
import { configuracionBaseInmobiliaria, evaluar } from '@agente-aml/riesgo';
import type { Dato, EntradaRevision } from '@agente-aml/agente';
import { construirPerfil, type OperacionParaPerfil } from '../src/perfil.js';

beforeAll(() => {
  process.env.META_APP_SECRET = 'x';
  process.env.META_VERIFY_TOKEN = 'y';
  process.env.INNGEST_DEV = '1';
});

const d = (valor: unknown): Dato => ({ valor, origen: 'cliente', confirmado: true });
const hoy = new Date('2026-11-16T12:00:00Z');

function entradaComprador(cambios: Record<string, unknown> = {}): EntradaRevision {
  const datos: Record<string, Dato> = {
    'cliente.nombre_completo': d('Ana Lucía Pérez Gómez'),
    'cliente.nacionalidad': d('guatemalteca'),
    'cliente.cargo_publico': d('no'),
    'cliente.familiar_cargo_publico': d('no'),
    'origen_fondos.descripcion': d('Préstamo hipotecario del Banco X'),
    'origen_fondos.pagador': d('el cliente'),
  };
  for (const [k, v] of Object.entries(cambios)) datos[k] = d(v);
  return {
    contexto: { parte: 'comprador', tipoPersona: 'individual' },
    datos,
    documentos: [{ clave: 'soporte_origen_fondos', estado: 'extraido' }],
  };
}

const operacion: OperacionParaPerfil = {
  tipo: 'compraventa',
  precio: 1540000,
  moneda: 'GTQ',
  valor_referencia: 1500000,
  inmueble: { departamento: 'Sacatepéquez' },
  forma_pago: [{ medio: 'financiamiento_bancario', monto: 1540000 }],
};

describe('perfil para el motor de riesgo', () => {
  it('convierte montos a USD con el tipo de cambio indicado por el oficial', () => {
    const { perfil } = construirPerfil(entradaComprador(), operacion, [{ fuente: 'onu', resultado: 'sin_coincidencia' }], { tipoCambioUsd: 7.7 }, hoy);
    expect(perfil.precioUsd).toBe(200000);
    expect(perfil.pagos[0].montoUsd).toBe(200000);
    expect(perfil.nacionalidad).toBe('GT');
    expect(perfil.departamentoInmueble).toBe('Sacatepéquez');
  });

  it('exige tipo de cambio cuando la operación no está en USD', () => {
    expect(() => construirPerfil(entradaComprador(), operacion, [], {}, hoy)).toThrow(/tipo de cambio/);
  });

  it('la vinculación por enlace o WhatsApp es no presencial salvo indicación del oficial', () => {
    const a = construirPerfil(entradaComprador(), operacion, [], { tipoCambioUsd: 7.7 }, hoy).perfil;
    const b = construirPerfil(entradaComprador(), operacion, [], { tipoCambioUsd: 7.7, presencial: true }, hoy).perfil;
    expect(a.presencial).toBe(false);
    expect(b.presencial).toBe(true);
  });

  it('declaración de cargo público se convierte en PEP', () => {
    const { perfil } = construirPerfil(entradaComprador({ 'cliente.cargo_publico': 'sí' }), operacion, [], { tipoCambioUsd: 7.7 }, hoy);
    expect(perfil.esPep).toBe(true);
  });

  it('sin cotejo ONU la debida diligencia no está completa y se advierte', () => {
    const { perfil, advertencias } = construirPerfil(entradaComprador(), operacion, [], { tipoCambioUsd: 7.7 }, hoy);
    expect(perfil.ddcCompleta).toBe(false);
    expect(advertencias.join(' ')).toMatch(/ONU/);
  });

  it('una posible coincidencia sin disponer llega al motor como posible', () => {
    const { perfil } = construirPerfil(entradaComprador(), operacion,
      [{ fuente: 'onu', resultado: 'descartada' }, { fuente: 'onu', resultado: 'posible_coincidencia' }], { tipoCambioUsd: 7.7 }, hoy);
    expect(perfil.coincidenciaOnu).toBe('posible');
    expect(evaluar(perfil, configuracionBaseInmobiliaria).propuesta).toBe('resolver_coincidencia');
  });

  it('pago por tercero declarado por el cliente', () => {
    const { perfil } = construirPerfil(entradaComprador({ 'origen_fondos.pagador': 'otra persona o empresa' }), operacion, [], { tipoCambioUsd: 7.7 }, hoy);
    expect(perfil.pagos[0].pagadorEsCliente).toBe(false);
  });

  it('persona jurídica: antigüedad y beneficiarios finales', () => {
    const entrada: EntradaRevision = {
      contexto: { parte: 'comprador', tipoPersona: 'juridica' },
      datos: { 'entidad.fecha_constitucion': d('2026-08-01'), 'entidad.lugar_constitucion': d('GT'), 'beneficiarios_finales': d([]) },
      documentos: [],
    };
    const { perfil } = construirPerfil(entrada, operacion, [], { tipoCambioUsd: 7.7 }, hoy);
    expect(perfil.antiguedadSociedadMeses).toBe(3);
    expect(perfil.beneficiarioFinalIdentificado).toBe(false);
  });
});

describe('API de la consola', () => {
  it('rechaza solicitudes sin sesión', async () => {
    const { app } = await import('../src/servidor.js');
    const r = await app.request('/api/consola/expedientes/x/evaluar', { method: 'POST', body: '{}' });
    expect(r.status).toBe(401);
  });

  it('permite el origen configurado de la consola y no otros (CORS)', async () => {
    const { app } = await import('../src/servidor.js');
    const ok = await app.request('/api/consola/expedientes/x/evaluar', {
      method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' },
    });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const no = await app.request('/api/consola/expedientes/x/evaluar', {
      method: 'OPTIONS', headers: { Origin: 'https://otro.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(no.headers.get('access-control-allow-origin')).toBeNull();
  });
});
