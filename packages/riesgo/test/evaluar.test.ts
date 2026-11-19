import { describe, expect, it } from 'vitest';
import {
  ConfiguracionInvalida,
  configuracionBaseInmobiliaria as base,
  evaluar,
  type ConfiguracionRiesgo,
  type PerfilEvaluacion,
} from '../src/index.js';

/** Comprador guatemalteco, individual, presencial, pago bancario: el caso más simple. */
const compradorSimple = (cambios: Partial<PerfilEvaluacion> = {}): PerfilEvaluacion => ({
  parte: 'comprador',
  tipoPersona: 'individual',
  esPep: false,
  vinculoPep: false,
  contratistaOProveedorEstado: false,
  sinFinesDeLucro: false,
  fideicomiso: false,
  noDomiciliado: false,
  beneficiarioFinalIdentificado: true,
  coherenciaPerfilMonto: 'coherente',
  nacionalidad: 'GT',
  paisResidencia: 'GT',
  departamentoInmueble: 'Guatemala',
  presencial: true,
  intermediario: false,
  actuaPorRepresentacion: false,
  tipoOperacion: 'compraventa',
  precioUsd: 200000,
  valorReferenciaUsd: 195000,
  pagos: [{ medio: 'financiamiento_bancario', montoUsd: 200000, pagadorEsCliente: true, paisOrigen: 'GT' }],
  origenFondosDeclarado: true,
  ddcCompleta: true,
  transaccionInusual: false,
  coincidenciaOnu: 'ninguna',
  ...cambios,
});

const conGafi: ConfiguracionRiesgo = { ...base, paisesAltoRiesgoGafi: ['XX'], paisesMonitoreoGafi: ['YY'] };

describe('motor de riesgo', () => {
  it('caso simple: riesgo bajo, DDC simplificada y listo para decidir', () => {
    const r = evaluar(compradorSimple(), base);
    expect(r.nivel).toBe('bajo');
    expect(r.medidas).toBe('simplificada');
    expect(r.propuesta).toBe('listo_para_decision');
    expect(r.situacionesEspeciales).toEqual([]);
    expect(r.proximaActualizacionMeses).toBe(36);
  });

  it('es determinista', () => {
    expect(evaluar(compradorSimple(), base)).toEqual(evaluar(compradorSimple(), base));
  });

  it('PEP: medidas intensificadas y nivel mínimo alto, sin bloquear (art. 2 g y 25 a)', () => {
    const r = evaluar(compradorSimple({ esPep: true }), base);
    expect(r.nivel).toBe('alto');
    expect(r.medidas).toBe('intensificada');
    expect(r.situacionesEspeciales).toContain('a');
    expect(r.reglas.find((x) => x.codigo === 'PEP')?.bloqueo).toBeUndefined();
    expect(r.proximaActualizacionMeses).toBeLessThanOrEqual(12);
  });

  it('país de alto riesgo GAFI en el origen de fondos fuerza intensificada (art. 24 ii)', () => {
    const r = evaluar(
      compradorSimple({ pagos: [{ medio: 'transferencia_exterior', montoUsd: 200000, pagadorEsCliente: true, paisOrigen: 'xx' }] }),
      conGafi,
    );
    expect(r.nivel).toBe('alto');
    expect(r.medidas).toBe('intensificada');
    expect(r.reglas.map((x) => x.codigo)).toContain('GAFI_ALTO_RIESGO');
  });

  it('coincidencia ONU confirmada: bloqueo y propuesta de comunicar al MP en 24 h (art. 43)', () => {
    const r = evaluar(compradorSimple({ coincidenciaOnu: 'confirmada' }), base);
    expect(r.propuesta).toBe('bloquear_y_comunicar_mp');
    expect(r.reglas.find((x) => x.codigo === 'ONU_CONFIRMADA')?.bloqueo).toBe(true);
    expect(r.nivel).toBe('alto');
  });

  it('posible coincidencia ONU: el oficial debe disponerla antes de decidir', () => {
    expect(evaluar(compradorSimple({ coincidenciaOnu: 'posible' }), base).propuesta).toBe('resolver_coincidencia');
  });

  it('coincidencia OFAC confirmada: riesgo alto y diligencia intensificada, sin bloqueo del art. 43', () => {
    const r = evaluar(compradorSimple({ coincidenciaOfac: 'confirmada' }), base);
    const regla = r.reglas.find((x) => x.codigo === 'OFAC_CONFIRMADA');
    expect(regla?.bloqueo).toBeUndefined();
    expect(r.nivel).toBe('alto');
    expect(r.medidas).toBe('intensificada');
    expect(r.propuesta).toBe('listo_para_decision');
  });

  it('posible coincidencia OFAC: el oficial la dispone antes de decidir', () => {
    expect(evaluar(compradorSimple({ coincidenciaOfac: 'posible' }), base).propuesta).toBe('resolver_coincidencia');
    // La ONU confirmada sigue mandando sobre OFAC
    expect(evaluar(compradorSimple({ coincidenciaOnu: 'confirmada', coincidenciaOfac: 'posible' }), base).propuesta).toBe('bloquear_y_comunicar_mp');
  });

  it('comprador sin origen de fondos: propuesta de abstención (art. 22)', () => {
    const r = evaluar(compradorSimple({ origenFondosDeclarado: false }), base);
    expect(r.propuesta).toBe('proponer_abstencion');
    expect(r.reglas.map((x) => x.codigo)).toEqual(expect.arrayContaining(['SIN_ORIGEN_FONDOS', 'DDC_INCOMPLETA']));
  });

  it('al vendedor no se le exige origen de fondos', () => {
    const r = evaluar(compradorSimple({ parte: 'vendedor', origenFondosDeclarado: false, pagos: [] }), base);
    expect(r.propuesta).toBe('listo_para_decision');
    expect(r.reglas.map((x) => x.codigo)).not.toContain('SIN_ORIGEN_FONDOS');
  });

  it('efectivo fraccionado en el mismo día: registro del art. 31 y señal de estructuración', () => {
    const r = evaluar(
      compradorSimple({
        pagos: [
          { medio: 'efectivo', montoUsd: 6000, pagadorEsCliente: true, fecha: '2026-11-10' },
          { medio: 'efectivo', montoUsd: 5000, pagadorEsCliente: true, fecha: '2026-11-10' },
          { medio: 'transferencia_local', montoUsd: 189000, pagadorEsCliente: true },
        ],
      }),
      base,
    );
    expect(r.registroEfectivo).toEqual({ requerido: true, totalMaximoDiarioUsd: 11000 });
    expect(r.senales.map((s) => s.codigo)).toContain('EFECTIVO_FRACCIONADO');
    expect(r.situacionesEspeciales).toContain('l');
  });

  it('efectivo en días distintos bajo el umbral no exige registro', () => {
    const r = evaluar(
      compradorSimple({
        pagos: [
          { medio: 'efectivo', montoUsd: 6000, pagadorEsCliente: true, fecha: '2026-11-10' },
          { medio: 'efectivo', montoUsd: 6000, pagadorEsCliente: true, fecha: '2026-11-11' },
        ],
      }),
      base,
    );
    expect(r.registroEfectivo.requerido).toBe(false);
  });

  it('pago de terceros, precio desviado y reventa rápida generan señales', () => {
    const comprador = evaluar(
      compradorSimple({
        precioUsd: 120000,
        valorReferenciaUsd: 200000,
        pagos: [{ medio: 'transferencia_local', montoUsd: 120000, pagadorEsCliente: false }],
      }),
      base,
    );
    expect(comprador.senales.map((s) => s.codigo)).toEqual(expect.arrayContaining(['PAGO_TERCEROS', 'PRECIO_DESVIADO']));
    const vendedor = evaluar(compradorSimple({ parte: 'vendedor', diasDesdeAdquisicion: 90, pagos: [] }), base);
    expect(vendedor.senales.map((s) => s.codigo)).toContain('REVENTA_RAPIDA');
  });

  it('sociedad reciente sin beneficiario final identificado eleva el riesgo', () => {
    const r = evaluar(
      compradorSimple({ tipoPersona: 'juridica', antiguedadSociedadMeses: 3, beneficiarioFinalIdentificado: false, nivelesPropiedad: 3 }),
      base,
    );
    expect(r.puntajes.cliente).toBe(100);
    expect(['medio', 'alto']).toContain(r.nivel);
    expect(r.senales.map((s) => s.codigo)).toEqual(expect.arrayContaining(['SOCIEDAD_RECIENTE', 'BF_NO_IDENTIFICADO']));
  });

  it('relación no presencial: situación especial k y no admite simplificada', () => {
    const r = evaluar(compradorSimple({ presencial: false }), base);
    expect(r.situacionesEspeciales).toContain('k');
    expect(r.medidas).not.toBe('simplificada');
  });

  it('transacción inusual: nunca simplificada (art. 23)', () => {
    expect(evaluar(compradorSimple({ transaccionInusual: true }), base).medidas).not.toBe('simplificada');
  });

  it('rechaza configuraciones que contradicen la ley', () => {
    expect(() => evaluar(compradorSimple(), { ...base, actualizacionMeses: { ...base.actualizacionMeses, alto: 18 } }))
      .toThrow(ConfiguracionInvalida);
    expect(() => evaluar(compradorSimple(), { ...base, umbralEfectivoUsd: 15000 })).toThrow(ConfiguracionInvalida);
    expect(() => evaluar(compradorSimple(), { ...base, pesosFactores: { cliente: 0.5, geografia: 0.5, canal: 0.5, producto: 0 } }))
      .toThrow(ConfiguracionInvalida);
  });

  it('explica cada punto asignado', () => {
    const r = evaluar(compradorSimple({ presencial: false }), base);
    expect(r.detalle.some((l) => l.includes('sin presencia física'))).toBe(true);
    expect(r.detalle.at(-1)).toMatch(/total ponderado/);
  });
});
