// Estado de la conexión (spec 009, RF-41). Lógica pura: la sonda y el reloj se inyectan para
// poder probarla sin navegador.
//
// Por qué no alcanza con `navigator.onLine`: una tablet conectada a un WiFi sin internet dice
// "online" y no llega al servidor. Por eso el estado combina tres fuentes:
//   1. Los eventos "online" / "offline" del navegador ("online" solo dispara una verificación).
//   2. Los fallos de red de los pedidos a la API (`hayFalloDeRed`).
//   3. Una sonda a GET /api/salud, cada 15 s mientras está "sin conexión".

export type Dependencias = {
  // Lo que dice el navegador al arrancar (navigator.onLine).
  enLineaInicial: () => boolean;
  // true si el servidor respondió de verdad (no un portal de WiFi). Puede tardar; nunca debería lanzar.
  sonda: () => Promise<boolean>;
  // Programa `fn` cada tanto y devuelve la función que lo cancela (setInterval en el navegador).
  programar: (fn: () => void) => () => void;
};

export type Conexion = {
  enLinea: () => boolean;
  // Avisa cada vez que CAMBIA el estado. Devuelve la función que cancela.
  suscribir: (fn: (enLinea: boolean) => void) => () => void;
  hayFalloDeRed: () => void; // un pedido a la API no pudo llegar al servidor
  hayRespuesta: () => void; // llegó una respuesta real de la API
  navegadorSinRed: () => void; // evento "offline"
  navegadorConRed: () => void; // evento "online": se confirma con la sonda
  revisarAhora: () => Promise<void>; // sonda inmediata
};

export function crearConexion(deps: Dependencias): Conexion {
  let enLinea = deps.enLineaInicial();
  const oyentes = new Set<(enLinea: boolean) => void>();
  let cancelarSondeo: (() => void) | null = null;
  let sondeando = false; // evita dos sondas a la vez

  function cambiar(nuevo: boolean) {
    if (nuevo === enLinea) return;
    enLinea = nuevo;
    for (const fn of [...oyentes]) fn(enLinea);
  }

  // Sonda: si el servidor responde, volvemos a "en línea" y dejamos de sondear.
  async function revisarAhora() {
    if (sondeando) return;
    sondeando = true;
    try {
      const ok = await deps.sonda().catch(() => false);
      if (ok) {
        detenerSondeo();
        cambiar(true);
      }
    } finally {
      sondeando = false;
    }
  }

  function iniciarSondeo() {
    cancelarSondeo ??= deps.programar(() => void revisarAhora());
  }

  function detenerSondeo() {
    cancelarSondeo?.();
    cancelarSondeo = null;
  }

  function irSinConexion() {
    cambiar(false);
    iniciarSondeo();
  }

  if (!enLinea) iniciarSondeo();

  return {
    enLinea: () => enLinea,
    suscribir(fn) {
      oyentes.add(fn);
      return () => oyentes.delete(fn);
    },
    hayFalloDeRed: irSinConexion,
    hayRespuesta() {
      detenerSondeo();
      cambiar(true);
    },
    navegadorSinRed: irSinConexion,
    navegadorConRed() {
      void revisarAhora();
    },
    revisarAhora,
  };
}

// ─── La conexión de la app (una sola, creada la primera vez que se usa) ───

const CADA_MS = 15_000;
const ESPERA_SONDA_MS = 5_000;

// Pregunta a GET /api/salud. Un portal cautivo devuelve HTML con código 200: no es JSON de la
// API, así que no cuenta como "hay conexión".
async function sondaDeLaApi(): Promise<boolean> {
  const control = new AbortController();
  const corte = setTimeout(() => control.abort(), ESPERA_SONDA_MS);
  try {
    const res = await fetch('/api/salud', { cache: 'no-store', signal: control.signal });
    if (!res.ok) return false;
    const cuerpo = (await res.json()) as { estado?: unknown } | null;
    return cuerpo?.estado === 'ok';
  } catch {
    return false;
  } finally {
    clearTimeout(corte);
  }
}

let global: Conexion | null = null;

export function obtenerConexion(): Conexion {
  if (global) return global;
  const c = crearConexion({
    enLineaInicial: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
    sonda: sondaDeLaApi,
    programar: (fn) => {
      const id = setInterval(fn, CADA_MS);
      return () => clearInterval(id);
    },
  });
  if (typeof window !== 'undefined') {
    window.addEventListener('offline', c.navegadorSinRed);
    window.addEventListener('online', c.navegadorConRed);
  }
  global = c;
  return c;
}
