import { EventSchemas, Inngest } from 'inngest';

type Eventos = {
  'aml/expediente.creado': { data: { organizacionId: string; expedienteId: string } };
  'aml/expediente.enviado_a_revision': { data: { organizacionId: string; expedienteId: string } };
  'aml/expediente.aprobado_diferido': { data: { organizacionId: string; expedienteId: string; hasta: string } };
  'aml/expediente.diferido_completado': { data: { organizacionId: string; expedienteId: string } };
  'aml/persona.identificada': {
    data: {
      organizacionId: string;
      expedienteId: string;
      personaRelacionadaId?: string;
      nombre: string;
      tipo: 'individual' | 'entidad';
      fechaNacimiento?: string;
    };
  };
  'aml/onu.coincidencia_confirmada': {
    data: { organizacionId: string; expedienteId: string; verificacionId: string; confirmadaEn: string };
  };
  'aml/alerta.cerrada': { data: { organizacionId: string; alertaId: string } };
  'aml/whatsapp.mensaje': {
    data: {
      phoneNumberId: string;
      waId: string;
      mensajeId: string;
      tipo: string;
      texto?: string;
      mediaId?: string;
      timestamp: string;
    };
  };
};

export const inngest = new Inngest({ id: 'agente-aml', schemas: new EventSchemas().fromRecord<Eventos>() });
