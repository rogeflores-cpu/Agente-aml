import { validarArchivo, type CodigoWhatsapp, type EstadoPortal, type FuentePortal, type MensajeConversacion } from './tipos';

/**
 * Fuente de demostración: simula al agente con respuestas guionadas para
 * presentar el portal sin servidor. Los nombres y datos son ficticios.
 */
interface Campo { campo: string; etiqueta: string; pregunta: string; normalizar?: (t: string) => string | null }
interface DocDemo { clave: string; nombre: string; pista: RegExp; lectura?: string }

const CAMPOS: Campo[] = [
  {
    campo: 'cliente.estado_civil', etiqueta: 'Estado civil', pregunta: '¿Cuál es su estado civil?',
    normalizar: (t) => {
      const x = t.toLowerCase();
      if (/casad/.test(x)) return 'casado';
      if (/solter/.test(x)) return 'soltero';
      if (/unid/.test(x)) return 'unido de hecho';
      if (/divorci/.test(x)) return 'divorciado';
      if (/viud/.test(x)) return 'viudo';
      return null;
    },
  },
  { campo: 'cliente.profesion', etiqueta: 'Profesión u oficio', pregunta: '¿Cuál es su profesión u oficio?' },
  { campo: 'origen_fondos.descripcion', etiqueta: 'Origen de los fondos', pregunta: '¿De dónde provienen los fondos con que pagará el inmueble (ahorros, préstamo bancario, venta de otro bien u otro)?' },
  { campo: 'origen_fondos.forma_pago', etiqueta: 'Forma de pago', pregunta: '¿Cómo realizará el pago (transferencia, cheque, financiamiento bancario u otro) y desde qué país?' },
];

const DOCUMENTOS: DocDemo[] = [
  { clave: 'dpi', nombre: 'DPI (ambos lados)', pista: /dpi|identif|cui/i, lectura: 'Nombre: SOFÍA ISABEL RAMÍREZ ORTEGA · CUI 2987 54321 0101 · Nacimiento: 03/09/1990' },
  { clave: 'recibo_servicio', nombre: 'Recibo de agua, luz o teléfono reciente', pista: /recibo|luz|agua|tel/i },
  { clave: 'soporte_origen_fondos', nombre: 'Documento que respalde el origen de los fondos', pista: /prest|banco|fondo|estado|cuenta|carta/i },
];

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function fuenteDemo(opciones: { demora?: number } = {}): FuentePortal {
  const demora = opciones.demora ?? 600;
  const datos = new Map<string, { valor: unknown; origen: string; confirmado: boolean }>([
    ['cliente.nombre_completo', { valor: 'Sofía Isabel Ramírez Ortega', origen: 'cliente', confirmado: true }],
  ]);
  const recibidos = new Set<string>();
  let porConfirmarDpi = false;
  let enRevision = false;
  const conversacion: MensajeConversacion[] = [{
    rol: 'agente',
    texto: 'Hola, Sofía. Soy el asistente de Inmuebles del Valle y le acompañaré para completar la información de su compra. Puede escribirme aquí o adjuntar sus documentos con el botón del clip. Para empezar: ¿cuál es su estado civil?',
  }];

  const faltantes = () => CAMPOS.filter((c) => !datos.has(c.campo));
  const docsFaltantes = () => DOCUMENTOS.filter((d) => !recibidos.has(d.clave));
  const pendientes = () => [
    ...faltantes().map((c) => ({ tipo: 'faltante', descripcion: c.etiqueta })),
    ...docsFaltantes().map((d) => ({ tipo: 'faltante', descripcion: d.nombre })),
    ...(porConfirmarDpi ? [{ tipo: 'aclaracion', descripcion: 'Confirme los datos leídos de su DPI' }] : []),
  ];

  const siguiente = (): string => {
    if (porConfirmarDpi) return '¿Los datos leídos de su DPI son correctos?';
    const c = faltantes()[0];
    if (c) return c.pregunta;
    const d = docsFaltantes()[0];
    if (d) return `Ahora necesito: ${d.nombre}. Puede adjuntarlo con el clip o en la pestaña Documentos.`;
    return 'Ya tenemos toda la información. Si está de acuerdo, use el botón «Enviar a revisión».';
  };

  const responder = (texto: string) => {
    conversacion.push({ rol: 'agente', texto });
    return texto;
  };

  return {
    modoDemo: true,

    async cargar(): Promise<EstadoPortal> {
      await esperar(demora / 3);
      return {
        marca: { nombreVisible: 'Inmuebles del Valle', colorPrimario: '#1d4ed8', logoUrl: null },
        vista: {
          nombreOrganizacion: 'Inmuebles del Valle',
          nombreCliente: 'Sofía Isabel Ramírez Ortega',
          parte: 'comprador',
          estado: enRevision ? 'En revisión' : 'Información en proceso',
          datos: [...datos.entries()].map(([campo, d]) => ({ campo, ...d })),
          documentos: [...recibidos].map((clave) => ({ clave, estado: 'recibido' })),
          pendientes: enRevision ? [] : pendientes(),
        },
        conversacion: [...conversacion],
      };
    },

    async enviarMensaje(texto) {
      conversacion.push({ rol: 'cliente', texto });
      await esperar(demora);
      if (enRevision) return responder('Su expediente ya está en revisión. Le avisaremos si necesitamos algo más.');
      if (porConfirmarDpi) {
        if (/^\s*(s[ií]|correct|confirm|est[aá]n bien|ok)/i.test(texto)) {
          porConfirmarDpi = false;
          for (const [campo, valor] of [['cliente.documento_tipo', 'DPI'], ['cliente.documento_numero', '2987 54321 0101'], ['cliente.fecha_nacimiento', '1990-09-03']]) {
            datos.set(campo, { valor, origen: 'documento', confirmado: true });
          }
          return responder(`Gracias por confirmar. ${siguiente()}`);
        }
        porConfirmarDpi = false;
        return responder('Entendido. Por favor indíqueme qué dato no es correcto para corregirlo, o envíe de nuevo la foto de su DPI.');
      }
      const campo = faltantes()[0];
      if (campo) {
        const valor = campo.normalizar ? campo.normalizar(texto) : texto.trim();
        if (valor === null) return responder('Disculpe, ¿me indica si es soltero, casado, unido de hecho, divorciado o viudo?');
        datos.set(campo.campo, { valor, origen: 'cliente', confirmado: true });
        return responder(`Gracias, lo registré. ${siguiente()}`);
      }
      return responder(siguiente());
    },

    async subirDocumento(archivo) {
      const error = validarArchivo(archivo);
      if (error) throw new Error(error);
      conversacion.push({ rol: 'cliente', texto: `[Archivo enviado: ${archivo.name}]` });
      await esperar(demora * 2);
      const doc = DOCUMENTOS.find((d) => d.pista.test(archivo.name) && !recibidos.has(d.clave)) ?? docsFaltantes()[0];
      if (!doc) return responder('Gracias, ya tenemos todos sus documentos. ' + siguiente());
      recibidos.add(doc.clave);
      if (doc.lectura) {
        porConfirmarDpi = true;
        return responder(`Recibí su DPI y lo leí. ${doc.lectura}. ¿Los datos son correctos?`);
      }
      return responder(`Recibí el documento «${doc.nombre}» y se leyó correctamente. ${siguiente()}`);
    },

    async codigoWhatsapp(): Promise<CodigoWhatsapp> {
      await esperar(demora / 2);
      const codigo = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
      return {
        codigo,
        numero: '+502 5555 0000',
        expiraEn: new Date(Date.now() + 30 * 60_000).toISOString(),
        enlaceWhatsapp: `https://wa.me/50255550000?text=${codigo}`,
      };
    },

    async enviarARevision() {
      await esperar(demora);
      const p = pendientes();
      if (p.length) return { enviado: false, pendientes: p.map((x) => x.descripcion) };
      enRevision = true;
      responder('Recibimos su información completa. El equipo de Inmuebles del Valle revisará su expediente y le avisará por este medio.');
      return { enviado: true, pendientes: [] };
    },
  };
}
