import { describe, expect, it, vi } from 'vitest';
import {
  atenderTurno,
  extraerDocumento,
  type ClienteClaude,
  type PuertoExpediente,
  type VistaCliente,
} from '../src/index.js';

/** Claude simulado: devuelve las respuestas en orden y guarda lo que recibió. */
function claudeSimulado(respuestas: any[]): ClienteClaude & { llamadas: any[] } {
  const llamadas: any[] = [];
  return {
    llamadas,
    messages: {
      create: vi.fn(async (p: any) => {
        llamadas.push(structuredClone(p));
        const r = respuestas.shift();
        if (!r) throw new Error('sin respuesta simulada');
        return { id: 'm', type: 'message', role: 'assistant', model: p.model, usage: {}, stop_sequence: null, ...r } as any;
      }),
    },
  };
}
const texto = (t: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
const herramienta = (name: string, input: unknown, id = `t${Math.random()}`) => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id, name, input }],
});

function puertoSimulado(): PuertoExpediente & { guardados: Record<string, unknown>; enviado: boolean } {
  const guardados: Record<string, unknown> = {};
  const vista: VistaCliente = {
    nombreOrganizacion: 'Demo Inmuebles',
    nombreCliente: 'Ana Pérez',
    contexto: { parte: 'comprador', tipoPersona: 'individual' },
    estado: 'Información en proceso',
    datos: [{ campo: 'doc.dpi.nombre_completo', valor: 'ANA PEREZ', origen: 'documento', confirmado: false }],
    documentos: [{ clave: 'dpi', estado: 'extraido' }],
    pendientes: [{ tipo: 'faltante', descripcion: 'Estado civil' }],
  };
  const p = {
    guardados,
    enviado: false,
    vista: vi.fn(async () => vista),
    guardarDato: vi.fn(async (c: string, v: unknown) => { guardados[c] = v; }),
    confirmarDato: vi.fn(async () => {}),
    enviarARevision: vi.fn(async () => { p.enviado = true; return { enviado: true, pendientes: [] }; }),
  };
  return p;
}

describe('agente del cliente', () => {
  it('guarda la respuesta del cliente con la herramienta y responde', async () => {
    const claude = claudeSimulado([
      herramienta('guardar_dato', { campo: 'cliente.estado_civil', valor: 'casado' }),
      texto('Gracias. ¿Cuál es su profesión u oficio?'),
    ]);
    const puerto = puertoSimulado();
    const r = await atenderTurno(claude, puerto, { historial: [], mensaje: 'Soy casada', canal: 'whatsapp' });
    expect(puerto.guardados).toEqual({ 'cliente.estado_civil': 'casado' });
    expect(r.respuesta).toBe('Gracias. ¿Cuál es su profesión u oficio?');
    expect(r.acciones[0].herramienta).toBe('guardar_dato');
    // El resultado de la herramienta vuelve al modelo en la segunda llamada
    const ultima = claude.llamadas[1].messages.at(-1);
    expect(ultima.content[0]).toMatchObject({ type: 'tool_result', is_error: false });
  });

  it('rechaza campos que no existen o que no aplican a la parte', async () => {
    const claude = claudeSimulado([
      herramienta('guardar_dato', { campo: 'certificacion_registral.propietario', valor: 'x' }),
      herramienta('guardar_dato', { campo: 'cliente.estado_civil', valor: 'complicado' }),
      texto('¿Me confirma su estado civil?'),
    ]);
    const puerto = puertoSimulado();
    const r = await atenderTurno(claude, puerto, { historial: [], mensaje: 'hola', canal: 'web' });
    expect(puerto.guardarDato).not.toHaveBeenCalled();
    expect(r.acciones.map((a) => (a.resultado as any).error).every(Boolean)).toBe(true);
  });

  it('reemplaza una respuesta con términos reservados (art. 38)', async () => {
    const claude = claudeSimulado([texto('Su nombre tuvo una coincidencia en la lista de la ONU, por eso se retrasa.')]);
    const r = await atenderTurno(claude, puertoSimulado(), { historial: [], mensaje: '¿Por qué tarda?', canal: 'whatsapp' });
    expect(r.respuestaReemplazada).toBe(true);
    expect(r.respuesta).not.toMatch(/ONU|coincidencia/i);
  });

  it('el contexto del modelo no contiene información de cumplimiento', async () => {
    const claude = claudeSimulado([herramienta('ver_expediente', {}), texto('Le falta indicar su estado civil.')]);
    await atenderTurno(claude, puertoSimulado(), { historial: [], mensaje: '¿Qué me falta?', canal: 'whatsapp' });
    const todo = JSON.stringify(claude.llamadas);
    expect(todo).not.toMatch(/verificaci|riesgo|alerta|decisi|en_examen/i);
  });

  it('envía a revisión cuando el cliente autoriza', async () => {
    const claude = claudeSimulado([herramienta('enviar_a_revision', {}), texto('Listo, su expediente fue enviado a revisión.')]);
    const puerto = puertoSimulado();
    await atenderTurno(claude, puerto, { historial: [], mensaje: 'Sí, envíelo', canal: 'web' });
    expect(puerto.enviado).toBe(true);
  });

  it('el historial siempre empieza con un mensaje del cliente', async () => {
    const claude = claudeSimulado([texto('Con gusto.')]);
    await atenderTurno(claude, puertoSimulado(), {
      historial: [{ rol: 'agente', texto: 'Bienvenida' }, { rol: 'cliente', texto: 'Hola' }, { rol: 'agente', texto: '¿En qué le ayudo?' }],
      mensaje: 'Quiero continuar',
      canal: 'whatsapp',
    });
    expect(claude.llamadas[0].messages[0].role).toBe('user');
    expect(claude.llamadas[0].system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('corta si el modelo encadena demasiadas herramientas', async () => {
    const claude = claudeSimulado(Array.from({ length: 3 }, () => herramienta('ver_expediente', {})));
    const r = await atenderTurno(claude, puertoSimulado(), { historial: [], mensaje: 'x', canal: 'web' }, { maxRondas: 3 });
    expect(r.acciones).toHaveLength(3);
    expect(r.respuesta.length).toBeGreaterThan(0);
  });
});

describe('extractor de documentos', () => {
  const archivo = { base64: 'AAAA', mime: 'image/jpeg' as const };
  const extraccion = (input: unknown) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'x', name: 'registrar_extraccion', input }] });

  it('valida la salida y marca los campos dudosos', async () => {
    const claude = claudeSimulado([extraccion({
      tipo_detectado: 'dpi', legible: true,
      campos: {
        nombre_completo: { valor: 'ANA LUCIA PEREZ', confianza: 0.97, pagina: 1 },
        cui: { valor: '2345678900101', confianza: 0.6, pagina: 1 },
        fecha_nacimiento: { valor: '1985-04-12', confianza: 0.95 },
        lugar_nacimiento: { valor: null, confianza: 0 },
        nacionalidad: { valor: 'GUATEMALTECA', confianza: 0.99 },
        genero: { valor: 'F', confianza: 0.99 },
        estado_civil: { valor: 'CASADA', confianza: 0.9 },
        fecha_vencimiento: { valor: '2030-04-12', confianza: 0.95 },
      },
    })]);
    const r = await extraerDocumento(claude, 'dpi', archivo);
    expect(r.tipoDistinto).toBe(false);
    expect(r.dudosos).toEqual(['cui']);
    const p = claude.llamadas[0];
    expect(p.tool_choice).toEqual({ type: 'tool', name: 'registrar_extraccion' });
    expect(p.messages[0].content[0].type).toBe('image');
    expect(Object.keys(p.tools[0].input_schema.properties.campos.properties)).toContain('cui');
  });

  it('detecta un documento distinto al esperado y usa bloque de documento para PDF', async () => {
    const claude = claudeSimulado([extraccion({ tipo_detectado: 'pasaporte', legible: true, campos: {} })]);
    const r = await extraerDocumento(claude, 'dpi', { base64: 'JVBER', mime: 'application/pdf' });
    expect(r.tipoDistinto).toBe(true);
    expect(claude.llamadas[0].messages[0].content[0].type).toBe('document');
  });

  it('rechaza una salida que no cumple el esquema', async () => {
    const claude = claudeSimulado([extraccion({ tipo_detectado: 'dpi', legible: 'si', campos: {} })]);
    await expect(extraerDocumento(claude, 'dpi', archivo)).rejects.toThrow();
  });
});
