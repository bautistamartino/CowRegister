// Marca de "cierre de sesión pendiente" (spec 009).
//
// Si cerrar sesión no llegó al servidor (sin conexión), la cookie sigue viva en el navegador. Se anota esta
// marca para cerrarla apenas haya señal, antes de preguntar quién está ingresado: si no, la persona que
// "cerró sesión" volvería a entrar sola. Lógica separada de React y del `localStorage` real (se inyecta el
// almacenamiento) para poder probarla.
//
// Importante: cuando se INGRESA con éxito (login, registro o sesión recuperada) hay que limpiar la marca, porque
// la cookie nueva reemplaza a la vieja; si no, el próximo arranque cerraría una sesión nueva y válida.

export type AlmacenMarca = { get(): string | null; set(valor: string): void; remove(): void };

const CLAVE = 'cowregister-cierre-pendiente';

// Almacenamiento real: localStorage, que puede fallar (modo privado). Los errores se tragan en `crearMarcaCierre`.
export const almacenMarcaLocalStorage: AlmacenMarca = {
  get: () => localStorage.getItem(CLAVE),
  set: (valor) => localStorage.setItem(CLAVE, valor),
  remove: () => localStorage.removeItem(CLAVE),
};

export type MarcaCierre = { poner(): void; limpiar(): void; hayPendiente(): boolean };

export function crearMarcaCierre(almacen: AlmacenMarca): MarcaCierre {
  return {
    poner() {
      try {
        almacen.set('1');
      } catch {
        /* sin almacenamiento: se sigue sin la marca */
      }
    },
    limpiar() {
      try {
        almacen.remove();
      } catch {
        /* sin almacenamiento: se sigue sin la marca */
      }
    },
    hayPendiente() {
      try {
        return almacen.get() === '1';
      } catch {
        return false;
      }
    },
  };
}

// Al abrir la app: si quedó un cierre a medias, se intenta completar. Si el servidor cerró (o ya no había
// sesión), se limpia la marca; si sigue sin red o falla, queda para el próximo arranque.
export async function completarCierrePendiente(marca: MarcaCierre, cerrarServidor: () => Promise<'cerrado' | 'sin-red'>): Promise<void> {
  if (!marca.hayPendiente()) return;
  const r = await cerrarServidor().catch(() => 'sin-red' as const);
  if (r === 'cerrado') marca.limpiar();
}
