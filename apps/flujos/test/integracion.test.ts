import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.INNGEST_DEV = '1';
});

describe('estado aparente hacia el cliente (art. 38)', () => {
  it('un examen abierto antes de decidir se ve como revisión', async () => {
    const { estadoAparente, politicaEdicion } = await import('../src/cotejos.js');
    expect(estadoAparente('en_examen', 'en_revision')).toBe('en_revision');
    expect(politicaEdicion(estadoAparente('en_examen', 'en_revision'))).toBe(politicaEdicion('en_revision'));
  });

  it('un examen abierto después de aprobar se ve igual que aprobado', async () => {
    const { estadoAparente, politicaEdicion } = await import('../src/cotejos.js');
    expect(estadoAparente('en_examen', 'aprobado', 'aprobar')).toBe('aprobado');
    expect(politicaEdicion(estadoAparente('en_examen', 'aprobado', 'aprobar'))).toBe(politicaEdicion('aprobado'));
  });

  it('con verificación diferida pendiente, el cliente puede seguir completando aunque haya examen', async () => {
    const { estadoAparente, politicaEdicion } = await import('../src/cotejos.js');
    expect(estadoAparente('en_examen', 'aprobado', 'aprobar_diferida')).toBe('aprobado_condicionado');
    expect(politicaEdicion(estadoAparente('en_examen', 'aprobado', 'aprobar_diferida'))).toBe('permitir');
  });

  it('un examen después de no aprobar se ve como finalizado', async () => {
    const { estadoAparente } = await import('../src/cotejos.js');
    expect(estadoAparente('en_examen', 'no_aprobado')).toBe('rechazado');
  });

  it('fuera del examen, el estado real no cambia', async () => {
    const { estadoAparente } = await import('../src/cotejos.js');
    for (const e of ['invitado', 'en_captura', 'en_revision', 'listo_para_decision', 'aprobado', 'aprobado_condicionado', 'rechazado', 'abstenido']) {
      expect(estadoAparente(e, 'aprobado')).toBe(e);
    }
  });
});

describe('reenvío de enlace con estado comercial', () => {
  it('trata como resueltos solo los estados comerciales finales', async () => {
    const { ESTADOS_COMERCIALES_FINALES } = await import('../src/api-operaciones.js');
    expect(ESTADOS_COMERCIALES_FINALES).toEqual(['aprobado', 'no_aprobado']);
  });
});

describe('actor de la bitácora para escrituras del servidor', () => {
  it('sin actor no envía cabeceras; con actor envía tipo e identificador', async () => {
    const { cabecerasActor, conActor } = await import('../src/datos.js');
    expect(cabecerasActor()).toEqual({});
    const dentro = conActor({ tipo: 'cliente', id: 'portal:exp-1' }, () => cabecerasActor());
    expect(dentro).toEqual({ 'x-aml-actor-tipo': 'cliente', 'x-aml-actor-id': 'portal:exp-1' });
  });

  it('el actor anidado (agente al leer un documento) prevalece y se propaga por await', async () => {
    const { cabecerasActor, conActor } = await import('../src/datos.js');
    const r = await conActor({ tipo: 'cliente', id: 'portal:exp-1' }, async () => {
      await Promise.resolve();
      return conActor({ tipo: 'agente', id: 'extraccion:web:exp-1' }, async () => {
        await new Promise((ok) => setTimeout(ok, 1));
        return cabecerasActor()['x-aml-actor-tipo'];
      });
    });
    expect(r).toBe('agente');
  });
});

describe('ancla diaria de la bitácora', () => {
  it('primera ancla: guarda el último eslabón sin alertar', async () => {
    const { evaluarAncla } = await import('../src/funciones/ancla-bitacora.js');
    expect(evaluarAncla(null, null, 0, { secuencia: 10, hash: 'a' })).toEqual({ anclaPreviaValida: null, problemas: 0, guardar: { secuencia: 10, hash: 'a' }, alertar: false });
  });

  it('sin eventos nuevos no duplica el ancla', async () => {
    const { evaluarAncla } = await import('../src/funciones/ancla-bitacora.js');
    const r = evaluarAncla({ secuencia: 10, hash: 'a' }, true, 0, { secuencia: 10, hash: 'a' });
    expect(r.guardar).toBeNull();
    expect(r.alertar).toBe(false);
  });

  it('alerta si el ancla previa ya no está en la cadena, si hay eslabones rotos o si la cadena se acortó', async () => {
    const { evaluarAncla } = await import('../src/funciones/ancla-bitacora.js');
    expect(evaluarAncla({ secuencia: 10, hash: 'a' }, false, 0, { secuencia: 12, hash: 'b' }).alertar).toBe(true);
    expect(evaluarAncla({ secuencia: 10, hash: 'a' }, true, 2, { secuencia: 12, hash: 'b' }).alertar).toBe(true);
    expect(evaluarAncla({ secuencia: 10, hash: 'a' }, false, 0, { secuencia: 7, hash: 'c' }).alertar).toBe(true);
    expect(evaluarAncla({ secuencia: 10, hash: 'a' }, false, 0, null).alertar).toBe(true);
  });

  it('la función diaria está registrada', async () => {
    const { funciones } = await import('../src/funciones/index.js');
    expect(funciones.map((f: any) => f.id())).toContain('ancla-bitacora');
  });
});

describe('códigos HTTP de las funciones de la base', () => {
  it('42501 → 403, validaciones → 400, reglas de negocio → 409', async () => {
    const { codigoHttp } = await import('../src/api-consola.js');
    expect(codigoHttp('42501')).toBe(403);
    expect(codigoHttp('22023')).toBe(400);
    expect(codigoHttp('23514')).toBe(400);
    expect(codigoHttp('P0001')).toBe(409);
    expect(codigoHttp(undefined)).toBe(409);
  });
});
