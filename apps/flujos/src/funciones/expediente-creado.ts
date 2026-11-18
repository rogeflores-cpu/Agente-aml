import { inngest } from '../cliente-inngest.js';
import { config } from '../config.js';
import { canalDeOrganizacion, db, notificar, sinError } from '../datos.js';
import { nuevoEnlace } from '../enlaces.js';
import { correoCliente, correoDisponible, correoValido, enviarCorreo } from '../correo.js';
import { enviarPlantilla } from '../whatsapp.js';

/**
 * Etapa 1: envía el enlace seguro y da seguimiento con recordatorios hasta que
 * el cliente envía su información a revisión.
 */
export const expedienteCreado = inngest.createFunction(
  { id: 'expediente-creado', concurrency: { key: 'event.data.organizacionId', limit: 20 } },
  { event: 'aml/expediente.creado' },
  async ({ event, step }) => {
    const { organizacionId, expedienteId } = event.data;

    const datos = await step.run('cargar-expediente', async () => {
      const exp = await sinError(
        db().from('expedientes')
          .select('contacto_nombre, contacto_telefono, contacto_correo, organizaciones(subdominio, nombre_comercial, marca)')
          .eq('id', expedienteId).eq('organizacion_id', organizacionId).single(),
      );
      const org: any = (exp as any).organizaciones;
      return {
        nombre: (exp as any).contacto_nombre as string,
        telefono: (exp as any).contacto_telefono as string | null,
        correo: (exp as any).contacto_correo as string | null,
        color: (org.marca?.color_primario ?? null) as string | null,
        subdominio: org.subdominio as string,
        nombreVisible: (org.marca?.nombre_visible ?? org.nombre_comercial) as string,
      };
    });

    // Se genera un enlace nuevo en cada envío; solo el último es válido.
    const enviarEnlace = async (plantilla: 'bienvenida' | 'recordatorio') => {
      const enlace = nuevoEnlace(datos.subdominio, config.dominioPortal, config.enlaceVigenciaDias);
      await sinError(
        db().from('expedientes')
          .update({ enlace_token_hash: enlace.tokenHash, enlace_expira_en: enlace.expiraEn })
          .eq('id', expedienteId),
      );
      // Canales en orden: WhatsApp (si está activo), correo y, si no hay ninguno, el ejecutivo lo comparte
      const canal = datos.telefono ? await canalDeOrganizacion(organizacionId) : null;
      if (canal && datos.telefono) {
        const destino = datos.telefono.replace(/[^\d]/g, '');
        const id = await enviarPlantilla(canal, destino, plantilla, [datos.nombre, datos.nombreVisible, enlace.url]);
        await sinError(db().from('mensajes').insert({
          organizacion_id: organizacionId, expediente_id: expedienteId, direccion: 'saliente',
          wa_id: destino, wa_message_id: id ?? null, tipo: 'template', plantilla,
        }));
        return { canal: 'whatsapp', id };
      }
      if (correoDisponible() && correoValido(datos.correo)) {
        const id = await enviarCorreo({
          para: datos.correo, nombreRemitente: datos.nombreVisible,
          ...correoCliente(plantilla, { nombre: datos.nombre, organizacion: datos.nombreVisible, enlace: enlace.url, venceEn: enlace.expiraEn, color: datos.color ?? undefined }),
        });
        await sinError(db().from('mensajes').insert({
          organizacion_id: organizacionId, expediente_id: expedienteId, direccion: 'saliente', canal: 'correo',
          correo_id: id, tipo: 'plantilla', plantilla,
        }));
        return { canal: 'correo', id };
      }
      await notificar(organizacionId, 'operativo', 'Enlace listo para compartir',
        `No hay WhatsApp activo ni correo del cliente. Comparta este enlace con ${datos.nombre}: ${enlace.url}`,
        { expedienteId });
      return { canal: 'manual' };
    };

    await step.run('enviar-bienvenida', () => enviarEnlace('bienvenida'));

    for (let i = 1; i <= config.recordatorios.cantidad; i++) {
      const enviado = await step.waitForEvent(`esperar-envio-${i}`, {
        event: 'aml/expediente.enviado_a_revision',
        timeout: config.recordatorios.intervalo,
        if: `async.data.expedienteId == '${expedienteId}'`,
      });
      if (enviado) return { resultado: 'enviado_a_revision', recordatorios: i - 1 };
      await step.run(`recordatorio-${i}`, () => enviarEnlace('recordatorio'));
    }

    await step.run('avisar-sin-respuesta', () =>
      notificar(organizacionId, 'operativo', 'Cliente sin completar su información',
        `${datos.nombre} no ha completado su expediente después de ${config.recordatorios.cantidad} recordatorios.`,
        { expedienteId }),
    );
    return { resultado: 'sin_respuesta' };
  },
);
