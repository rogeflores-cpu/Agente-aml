import { cotejar } from '@agente-aml/listas';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/datos.js', () => ({ db: {}, notificar: vi.fn(), sinError: (r: any) => r.data }));

const { comoRegistro } = await import('../src/designaciones.js');
const { esquemaDesignacion } = await import('../src/api-plataforma.js');
const { construirPerfil } = await import('../src/perfil.js');

const designacion = {
  id: '00000000-0000-0000-0000-000000001373',
  tipo: 'individual' as const,
  nombre: 'Juan Carlos Méndez Orellana',
  alias: ['El Contador'],
  documentos: ['1234567890101'],
  fechas_nacimiento: ['1975-03-14'],
  nacionalidades: ['GT'],
  autoridad: 'Guatemala · Ministerio Público',
  referencia: 'Oficio MP-1373-001-2026',
};

describe('art. 43 c: designaciones de la S/RES/1373', () => {
  it('se cotejan con el mismo motor que la lista de la ONU, alias incluidos', () => {
    const r = comoRegistro(designacion);
    expect(r.referencia).toBe(`1373:${designacion.id}`);
    expect(r.lista).toContain('S/RES/1373');
    const porNombre = cotejar({ nombre: 'JUAN CARLOS MENDEZ ORELLANA', tipo: 'individual', fechaNacimiento: '1975-03-14' }, [r]);
    expect(porNombre).toHaveLength(1);
    expect(porNombre[0].prioridad).toBe('alta');
    expect(cotejar({ nombre: 'El Contador', tipo: 'individual' }, [r])).toHaveLength(1);
    expect(cotejar({ nombre: 'María Fernanda López', tipo: 'individual' }, [r])).toHaveLength(0);
    // Una entidad no coincide con una persona individual
    expect(cotejar({ nombre: 'Juan Carlos Méndez Orellana', tipo: 'entidad' }, [r])).toHaveLength(0);
  });

  it('el registro exige autoridad, referencia y fecha no futura', () => {
    const base = {
      tipo: 'individual', nombre: 'Juan Carlos Méndez', autoridad: 'Guatemala · MP', referencia: 'Oficio 1-2026', designadaEl: '2026-01-15',
    };
    expect(esquemaDesignacion.safeParse(base).success).toBe(true);
    expect(esquemaDesignacion.safeParse({ ...base, designadaEl: '2999-01-01' }).success).toBe(false);
    expect(esquemaDesignacion.safeParse({ ...base, referencia: '' }).success).toBe(false);
    expect(esquemaDesignacion.safeParse({ ...base, autoridad: undefined }).success).toBe(false);
    expect(esquemaDesignacion.safeParse({ ...base, fechasNacimiento: ['14/03/1975'] }).success).toBe(false);
    expect(esquemaDesignacion.safeParse({ ...base, nacionalidades: ['Guatemala'] }).success).toBe(false);
  });

  it('una coincidencia 1373 pesa en el riesgo igual que una de la ONU', () => {
    const operacion = { tipo: 'compraventa' as const, precio: 65000, moneda: 'USD', valor_referencia: null, inmueble: null, forma_pago: [] };
    const entrada = {
      contexto: { parte: 'comprador' as const, tipoPersona: 'individual' as const },
      datos: { 'cliente.nombre_completo': { valor: 'Juan Carlos Méndez Orellana', origen: 'cliente' as const, confirmado: true } },
      documentos: [],
    };
    const ver = (fuente: string, resultado: string) => ({ fuente, resultado, nombre_consultado: 'Juan Carlos Méndez Orellana' });
    const soloOnu = construirPerfil(entrada, operacion, [ver('onu', 'sin_coincidencia')] as any);
    expect(soloOnu.perfil.coincidenciaOnu).toBe('ninguna');
    const confirmada = construirPerfil(entrada, operacion, [ver('onu', 'sin_coincidencia'), ver('designacion_1373', 'coincidencia_confirmada')] as any);
    expect(confirmada.perfil.coincidenciaOnu).toBe('confirmada');
    const posible = construirPerfil(entrada, operacion, [ver('onu', 'sin_coincidencia'), ver('designacion_1373', 'posible_coincidencia')] as any);
    expect(posible.perfil.coincidenciaOnu).toBe('posible');
    // Sin cotejo ONU se sigue advirtiendo aunque haya cotejo 1373
    const sinOnu = construirPerfil(entrada, operacion, [ver('designacion_1373', 'sin_coincidencia')] as any);
    expect(sinOnu.advertencias.some((a) => a.includes('lista de la ONU'))).toBe(true);
  });
});

describe('despliegue', () => {
  it('lista las variables de entorno que faltan, incluidas las de Inngest fuera de desarrollo', async () => {
    const { variablesFaltantes, VARIABLES_REQUERIDAS } = await import('../src/servidor.js');
    const completo = Object.fromEntries([...VARIABLES_REQUERIDAS, 'INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY'].map((v) => [v, 'x']));
    expect(variablesFaltantes(completo)).toEqual([]);
    expect(variablesFaltantes({ ...completo, ANTHROPIC_API_KEY: '' })).toEqual(['ANTHROPIC_API_KEY']);
    const { INNGEST_EVENT_KEY: _a, INNGEST_SIGNING_KEY: _b, ...sinInngest } = completo;
    expect(variablesFaltantes(sinInngest)).toEqual(['INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY']);
    expect(variablesFaltantes({ ...sinInngest, INNGEST_DEV: '1' })).toEqual([]);
  });
});

describe('corrección de datos por el oficial', () => {
  it('valida el valor según el tipo de campo del catálogo', async () => {
    const { valorCorregido } = await import('../src/api-consola.js');
    const base = { campo: 'x', etiqueta: 'x', pregunta: 'x', aplica: () => true };
    expect(valorCorregido({ ...base, tipo: 'texto' } as any, '  Ingeniero civil ')).toEqual({ valor: 'Ingeniero civil' });
    expect(valorCorregido({ ...base, tipo: 'texto' } as any, '  ')).toHaveProperty('error');
    expect(valorCorregido({ ...base, tipo: 'si_no' } as any, 'Sí')).toEqual({ valor: true });
    expect(valorCorregido({ ...base, tipo: 'si_no' } as any, 'tal vez')).toHaveProperty('error');
    expect(valorCorregido({ ...base, tipo: 'opcion', opciones: ['a', 'b'] } as any, 'c')).toHaveProperty('error');
    expect(valorCorregido({ ...base, tipo: 'fecha' } as any, '1980-02-30x')).toHaveProperty('error');
    expect(valorCorregido({ ...base, tipo: 'lista' } as any, [])).toHaveProperty('error');
    expect(valorCorregido({ ...base, tipo: 'lista' } as any, [{ nombre: 'Ana', porcentaje: 60 }])).toEqual({ valor: [{ nombre: 'Ana', porcentaje: 60 }] });
  });
});

describe('listas del GAFI', () => {
  it('valida la versión de un pleno (códigos ISO, fecha no futura, URL oficiales)', async () => {
    const { esquemaListaGafi } = await import('../src/reglas-consola.js');
    const base = {
      plenario: '2026-10-30', altoRiesgo: ['kp', 'IR', 'MM'], monitoreo: ['AO', 'VG'],
      fuenteAltoRiesgo: 'https://www.fatf-gafi.org/a.html', fuenteMonitoreo: 'https://www.fatf-gafi.org/b.html',
    };
    const r = esquemaListaGafi.safeParse(base);
    expect(r.success && r.data.altoRiesgo).toEqual(['KP', 'IR', 'MM']);
    expect(esquemaListaGafi.safeParse({ ...base, plenario: '2999-01-01' }).success).toBe(false);
    expect(esquemaListaGafi.safeParse({ ...base, monitoreo: ['VEN'] }).success).toBe(false);
    expect(esquemaListaGafi.safeParse({ ...base, fuenteMonitoreo: 'no es url' }).success).toBe(false);
  });
});
