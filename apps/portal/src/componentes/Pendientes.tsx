import type { VistaPortal } from '../fuente/tipos';

const TIPO: Record<string, string> = {
  faltante: 'Falta', ilegible: 'Enviar de nuevo', vencido: 'Actualizar', contradiccion: 'Revisar', aclaracion: 'Aclarar',
};

export function Pendientes({
  vista, ocupado, alEnviarARevision, resultado,
}: { vista: VistaPortal; ocupado: boolean; alEnviarARevision: () => void; resultado: string[] | null }) {
  const listo = vista.pendientes.length === 0;
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-borde bg-white p-4">
        {listo ? (
          <p className="text-[15px]">No tiene pendientes. Puede enviar su expediente a revisión.</p>
        ) : (
          <ul className="space-y-3">
            {vista.pendientes.map((p, i) => (
              <li key={i} className="flex gap-3 text-[15px]">
                <span className="mt-0.5 shrink-0 self-start whitespace-nowrap rounded-full bg-marca-claro px-2 py-0.5 text-xs font-medium text-marca">{TIPO[p.tipo] ?? 'Pendiente'}</span>
                <span>{p.descripcion}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {resultado && resultado.length > 0 && (
        <p className="rounded-xl bg-error-claro px-4 py-3 text-sm text-error" role="alert">
          Aún no se puede enviar. Complete primero: {resultado.join('; ')}.
        </p>
      )}
      <button onClick={alEnviarARevision} disabled={ocupado}
        className="w-full rounded-full bg-marca py-3 text-[15px] font-medium text-sobre-marca disabled:opacity-40">
        {ocupado ? 'Enviando…' : 'Enviar a revisión'}
      </button>
      <p className="text-center text-xs text-tinta-suave">Al enviar, confirma que la información y los documentos son verdaderos y están vigentes.</p>
    </div>
  );
}
