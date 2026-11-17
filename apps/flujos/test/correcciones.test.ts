import { personasIdentificadas } from '@agente-aml/agente';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/datos.js', () => ({ db: {}, notificar: vi.fn(), sinError: (r: any) => r.data }));

const { cotejosPendientes, idEventoCotejo, politicaEdicion, codigoPermitido, LIMITE_CODIGOS, MENSAJE_NO_EDITABLE } = await import('../src/cotejos.js');
const { planificarActualizacion } = await import('../src/lista-onu.js');
const { plazosArt43 } = await import('../src/funciones/plazos.js');
const reglas = await import('../src/reglas-consola.js');
const { construirPerfil } = await import('../src/perfil.js');
const { terminoReservado } = await import('@agente-aml/agente');

const d = (valor: unknown, origen: 'cliente' | 'documento' = 'cliente', confirmado = true) => ({ valor, origen, confirmado });

describe('A1/A5: cotejo ONU de toda persona identificada', () => {
  const personas = personasIdentificadas({ parte: 'comprador', tipoPersona: 'juridica' }, {
    'entidad.razon_social': d('Inversiones Demo, S.A.'),
    'representante.nombre_completo': d('ROBERTO CIFUENTES', 'documento', false),
    beneficiarios_finales: d([{ nombre: 'Ana Pérez', porcentaje: 60 }, { nombre: 'Roberto Cifuentes', porcentaje: 40 }]),
  });

  it('coteja entidad, representante (aunque venga de un documento sin confirmar) y beneficiarios, sin duplicar', () => {
    expect(cotejosPendientes(personas, [], 'v1').map((p) => p.nombre)).toEqual(['Inversiones Demo, S.A.', 'ROBERTO CIFUENTES', 'Ana Pérez']);
  });

  it('no repite lo ya cotejado con la versión vigente, pero sí con una versión anterior', () => {
    const hechas = [{ nombre_consultado: 'Ana  Perez', version_fuente: 'v1' }];
    expect(cotejosPendientes(personas, hechas, 'v1').map((p) => p.nombre)).not.toContain('Ana Pérez');
    expect(cotejosPendientes(personas, hechas, 'v2').map((p) => p.nombre)).toContain('Ana Pérez');
  });

  it('un nombre cambiado vuelve a cotejarse; el id de evento es estable por nombre y versión', () => {
    const cambiado = personasIdentificadas({ parte: 'comprador', tipoPersona: 'individual' }, { 'cliente.nombre_completo': d('Ana María Pérez') });
    expect(cotejosPendientes(cambiado, [{ nombre_consultado: 'Ana Pérez', version_fuente: 'v1' }], 'v1')).toHaveLength(1);
    expect(idEventoCotejo('e1', 'Ana Pérez', 'v1')).toBe(idEventoCotejo('e1', 'ANA PEREZ', 'v1'));
    expect(idEventoCotejo('e1', 'Ana Pérez', 'v1')).not.toBe(idEventoCotejo('e1', 'Ana Pérez', 'v2'));
  });
});

describe('A5: actualización de la lista ONU', () => {
  const r = (referencia: string, nombre: string) => ({ referencia, lista: 'Al-Qaida', tipo: 'individual' as const, nombre, alias: [], fechasNacimiento: [], nacionalidades: [], documentos: [] });
  it('si la carga anterior quedó a medias, recoteja contra toda la lista aunque el hash coincida', () => {
    const lista = { sha256: 'h', registros: [r('1', 'A'), r('2', 'B')] };
    expect(planificarActualizacion(lista, { sha256: 'h', registros: lista.registros }, false).sinCambios).toBe(true);
    const plan = planificarActualizacion(lista, { sha256: 'h', registros: lista.registros }, true);
    expect(plan.sinCambios).toBe(false);
    expect(plan.revisar).toHaveLength(2);
  });
});

describe('A6: plazos del art. 43 desde la detección', () => {
  it('vence 24 h después de detectar y escala a las 4 h y a las 20 h', () => {
    const p = plazosArt43('2026-11-16T10:00:00Z');
    expect(p.vence.toISOString()).toBe('2026-11-17T10:00:00.000Z');
    expect(p.escalarSinDisponer.toISOString()).toBe('2026-11-16T14:00:00.000Z');
    expect(p.escalarFinal.toISOString()).toBe('2026-11-17T06:00:00.000Z');
  });
});

describe('A3: límites de códigos por WhatsApp', () => {
  it('deja de comprobar códigos tras el límite por número o por organización', () => {
    expect(codigoPermitido(0, 0)).toBe(true);
    expect(codigoPermitido(LIMITE_CODIGOS.porNumero, 0)).toBe(false);
    expect(codigoPermitido(0, LIMITE_CODIGOS.porOrganizacion)).toBe(false);
  });
});

describe('M4/B9: edición según el estado del expediente', () => {
  it.each([
    ['en_captura', 'permitir'], ['aprobado_condicionado', 'permitir'],
    ['en_revision', 'permitir_y_avisar'], ['en_examen', 'permitir_y_avisar'],
    ['aprobado', 'rechazar'], ['rechazado', 'rechazar'], ['abstenido', 'rechazar'],
  ])('%s → %s', (estado, politica) => expect(politicaEdicion(estado)).toBe(politica));

  it('el mensaje al cliente es neutro', () => expect(terminoReservado(MENSAJE_NO_EDITABLE)).toBeNull());
});

describe('reglas de la consola', () => {
  it('M1: el ajuste manual no baja del nivel que imponen las reglas', () => {
    expect(reglas.ajustePermitido('bajo', [{ nivelMinimo: 'alto' }])).toBe(false);
    expect(reglas.ajustePermitido('alto', [{ nivelMinimo: 'medio' }])).toBe(true);
    expect(reglas.ajustePermitido('bajo', [])).toBe(true);
  });

  it('M4: una evaluación anterior al último cambio no sirve para aprobar', () => {
    expect(reglas.evaluacionVigente('2026-11-16T10:00:00Z', '2026-11-16T11:00:00Z')).toBe(false);
    expect(reglas.evaluacionVigente('2026-11-16T12:00:00Z', '2026-11-16T11:00:00Z')).toBe(true);
  });

  it('M6: el pleno del GAFI no puede ser futuro y el correo debe estar verificado', () => {
    const ahora = new Date('2026-11-16T15:00:00Z');
    expect(reglas.plenarioValido('2026-10-24', ahora)).toBe(true);
    expect(reglas.plenarioValido('2027-02-20', ahora)).toBe(false);
    expect(reglas.plenarioValido('24/10/2026', ahora)).toBe(false);
    expect(reglas.correoVerificado({ email: 'a@b.c' })).toBe(false);
    expect(reglas.correoVerificado({ email: 'a@b.c', email_confirmed_at: '2026-01-01' })).toBe(true);
  });

  it('M3: normaliza documentos y no vincula fichas de otra persona con el mismo número', () => {
    expect(reglas.normalizarDocumento('cui', '2345 67890 0101')).toEqual({ tipo: 'DPI', numero: '2345678900101' });
    expect(reglas.normalizarDocumento('pasaporte', 'ab-123 45')).toEqual({ tipo: 'PASAPORTE', numero: 'AB12345' });
    expect(reglas.mismaPersona('Ana María Pérez López', 'ANA MARIA PEREZ LOPEZ', false)).toBe(true);
    expect(reglas.mismaPersona('Ana María Pérez López', 'Luis Gómez', false)).toBe(false);
  });
});

describe('M7: PEP en personas jurídicas', () => {
  it('beneficiario final con cargo público → esPep; representante → vínculo', () => {
    const operacion = { tipo: 'compraventa' as const, precio: 770000, moneda: 'USD', valor_referencia: null, inmueble: null, forma_pago: [] };
    const entrada = (datos: Record<string, any>) => ({ contexto: { parte: 'comprador' as const, tipoPersona: 'juridica' as const }, datos, documentos: [] });
    const a = construirPerfil(entrada({ 'beneficiarios_finales.cargo_publico': d(true) }), operacion, []).perfil;
    expect(a.esPep).toBe(true);
    const b = construirPerfil(entrada({ 'representante.cargo_publico': d('sí') }), operacion, []).perfil;
    expect(b.vinculoPep).toBe(true);
  });
});
