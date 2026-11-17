import Anthropic from '@anthropic-ai/sdk';
import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages/messages';

/** Lo único que el agente necesita del SDK. Permite pruebas sin red. */
export interface ClienteClaude {
  messages: { create(params: MessageCreateParamsNonStreaming): Promise<Message> };
}

export const modelos = {
  /** Conversación con el cliente: rápido y económico. */
  conversacion: process.env.AML_MODELO_CONVERSACION ?? 'claude-haiku-5-5',
  /** Lectura de documentos y resumen del caso: más preciso. */
  documentos: process.env.AML_MODELO_DOCUMENTOS ?? 'claude-sonnet-5-5',
};

export function clienteClaude(apiKey = process.env.ANTHROPIC_API_KEY): ClienteClaude {
  if (!apiKey) throw new Error('Falta ANTHROPIC_API_KEY');
  return new Anthropic({ apiKey });
}
