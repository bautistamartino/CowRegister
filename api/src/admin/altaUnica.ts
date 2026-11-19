import { prisma } from '../db.js';
import { emailSchema, nombreSchema, passwordSchema } from '../validacion.js';
import { hashearPassword } from '../auth/password.js';
import { esErrorPrisma } from '../errores.js';
import { MENSAJE_EMAIL_REPETIDO, emailEnUso } from './choques.js';

// Alta única del primer (y único) administrador (spec 014, RF-9, RF-10, RF-11).
// La lógica está acá, separada del script, para poder probarla sin lanzar procesos: la entrada
// (argumentos, variables de entorno, contraseña tipeada) y la salida se inyectan.

export interface EntradaAltaUnica {
  argumentos: string[]; // lo que viene después de "--": --nombre "X" --email x@y.com
  env: Record<string, string | undefined>;
  leerPassword: () => Promise<string>; // entrada SIN eco, usada si no hay ADMIN_PASSWORD
  escribir: (texto: string) => void; // todo lo que se muestra pasa por acá
}

// Lee "--clave valor" y "--clave=valor".
function leerArgumentos(argumentos: string[]): Record<string, string> {
  const valores: Record<string, string> = {};
  for (let i = 0; i < argumentos.length; i++) {
    const actual = argumentos[i];
    if (!actual.startsWith('--')) continue;
    const igual = actual.indexOf('=');
    if (igual > 0) valores[actual.slice(2, igual)] = actual.slice(igual + 1);
    else if (i + 1 < argumentos.length) valores[actual.slice(2)] = argumentos[++i];
  }
  return valores;
}

/**
 * Devuelve el código de salida: 0 si creó al administrador, 1 si se detuvo sin cambios.
 * NUNCA escribe la contraseña ni el hash: los mensajes de error tampoco repiten el valor.
 */
export async function ejecutarAltaUnica(entrada: EntradaAltaUnica): Promise<number> {
  const { escribir } = entrada;
  const args = leerArgumentos(entrada.argumentos);

  const nombre = nombreSchema.safeParse(args.nombre);
  const email = emailSchema.safeParse(args.email);
  if (!nombre.success || !email.success) {
    escribir('Uso: npm run admin:crear -w api -- --nombre "Nombre" --email correo@ejemplo.com');
    if (!nombre.success) escribir(`Nombre: ${nombre.error.issues[0].message}`);
    if (!email.success) escribir(`Email: ${email.error.issues[0].message}`);
    return 1;
  }

  // Se controla antes de pedir la contraseña, para no hacer tipear en vano.
  if ((await prisma.administrador.count()) > 0) {
    escribir('Ya hay un administrador. No se hizo ningún cambio.');
    return 1;
  }
  if (await emailEnUso(email.data)) {
    escribir(`${MENSAJE_EMAIL_REPETIDO}. No se hizo ningún cambio.`);
    return 1;
  }

  // La contraseña viene de ADMIN_PASSWORD (puesta en la misma línea del comando, no en .env) o se
  // pide por consola sin mostrarla.
  const password = passwordSchema.safeParse(entrada.env.ADMIN_PASSWORD ?? (await entrada.leerPassword()));
  if (!password.success) {
    escribir(`Contraseña: ${password.error.issues[0].message}`);
    return 1;
  }

  try {
    await prisma.administrador.create({
      data: { nombre: nombre.data, email: email.data, passwordHash: await hashearPassword(password.data) },
    });
  } catch (err) {
    // Dos altas simultáneas: el índice de "un solo administrador" o el disparador de email único
    // dejan pasar solo una. La otra termina acá, con un mensaje claro.
    if (esErrorPrisma(err, 'P2002')) {
      escribir(
        (await emailEnUso(email.data))
          ? `${MENSAJE_EMAIL_REPETIDO}. No se hizo ningún cambio.`
          : 'Ya hay un administrador. No se hizo ningún cambio.',
      );
      return 1;
    }
    throw err;
  }

  escribir(`Administrador creado: ${nombre.data} <${email.data}>.`);
  return 0;
}
