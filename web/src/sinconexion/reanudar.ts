import type { crearSincronizador } from './sincronizar';

// Reintentar o descartar un pendiente rechazado tiene que despertar a los de la misma vaca que esperaban por él
// (spec 010, RF-27). Eso lo hace una ronda COMPLETA (sin `soloId`): una ronda de un solo pendiente se corta ahí y los
// demás quedarían "en espera del anterior" hasta reabrir la app. Es una función aparte para poder probarla sin React.

type Sincronizador = ReturnType<typeof crearSincronizador>;
type Resultado = Awaited<ReturnType<Sincronizador['descartar']>>;

export async function reintentarYReanudar(sinc: Sincronizador, id: string, correrRonda: () => Promise<void>): Promise<void> {
  await sinc.reintentar(id);
  await correrRonda();
}

export async function descartarYReanudar(sinc: Sincronizador, id: string, opciones: { confirmado?: boolean } | undefined, correrRonda: () => Promise<void>): Promise<Resultado> {
  const r = await sinc.descartar(id, opciones);
  // Solo si de verdad se quitó algo: con 'requiere-confirmacion' o 'no-existe' no cambió nada que reanudar.
  if (r === 'descartado') await correrRonda();
  return r;
}
