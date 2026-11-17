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
