import { useEffect, useRef, useState } from 'react';
import type { MensajeConversacion } from '../fuente/tipos';

export function Conversacion({
  mensajes, ocupado, alEnviar, alAdjuntar, deshabilitado,
}: {
  mensajes: MensajeConversacion[];
  ocupado: boolean;
  alEnviar: (texto: string) => void;
  alAdjuntar: (archivo: File) => void;
  deshabilitado?: boolean;
}) {
  const [texto, setTexto] = useState('');
  const fin = useRef<HTMLDivElement>(null);
  const archivo = useRef<HTMLInputElement>(null);
  useEffect(() => { fin.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' }); }, [mensajes.length, ocupado]);

  const enviar = () => {
    const t = texto.trim();
    if (!t || ocupado) return;
    setTexto('');
    alEnviar(t);
  };

  return (
    <div className="flex flex-col rounded-2xl border border-borde bg-white">
      <div className="max-h-[55vh] min-h-64 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {mensajes.map((m, i) => (
          <div key={i} className={`flex ${m.rol === 'cliente' ? 'justify-end' : 'justify-start'}`}>
            <p className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[15px] leading-snug ${
              m.rol === 'cliente' ? 'rounded-br-md bg-marca text-sobre-marca' : 'rounded-bl-md bg-papel text-tinta'}`}>
              {m.texto}
            </p>
          </div>
        ))}
        {ocupado && (
          <div className="flex justify-start">
            <p className="rounded-2xl rounded-bl-md bg-papel px-3.5 py-2 text-sm text-tinta-suave">Escribiendo…</p>
          </div>
        )}
        <div ref={fin} />
      </div>
      <form className="flex items-end gap-2 border-t border-borde p-3" onSubmit={(e) => { e.preventDefault(); enviar(); }}>
        <input ref={archivo} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) alAdjuntar(f); e.target.value = ''; }} />
        <button type="button" aria-label="Adjuntar documento" disabled={ocupado || deshabilitado} onClick={() => archivo.current?.click()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-borde text-tinta-suave hover:bg-papel disabled:opacity-40">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <textarea value={texto} rows={1} maxLength={2000} disabled={deshabilitado} placeholder={deshabilitado ? 'Su expediente está en revisión' : 'Escriba su respuesta'}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-borde px-3.5 py-2.5 text-[15px] outline-none focus:border-marca disabled:bg-papel" />
        <button type="submit" disabled={ocupado || !texto.trim() || deshabilitado}
          className="h-11 shrink-0 rounded-full bg-marca px-4 text-sm font-medium text-sobre-marca disabled:opacity-40">
          Enviar
        </button>
      </form>
    </div>
  );
}
