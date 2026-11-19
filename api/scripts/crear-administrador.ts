import { Writable } from 'node:stream';
import { createInterface } from 'node:readline';
import { prisma } from '../src/db.js';
import { ejecutarAltaUnica } from '../src/admin/altaUnica.js';

// Crea al administrador de la plataforma (se corre una sola vez).
//   npm run admin:crear -w api -- --nombre "Nombre" --email correo@ejemplo.com
// La contraseña se toma de ADMIN_PASSWORD si la ponés en la misma línea del comando; si no, se
// pide por consola sin mostrarla. No la guardes en el .env.

// Pregunta algo y NO muestra lo que se tipea (la pregunta sí se ve).
function preguntarSinEco(pregunta: string): Promise<string> {
  return new Promise((resolve) => {
    let silenciado = false;
    const salida = new Writable({
      write(trozo, _codificacion, listo) {
        if (!silenciado) process.stdout.write(trozo);
        listo();
      },
    });
    const lector = createInterface({ input: process.stdin, output: salida, terminal: true });
    lector.question(pregunta, (respuesta) => {
      lector.close();
      process.stdout.write('\n');
      resolve(respuesta);
    });
    silenciado = true; // la pregunta ya se escribió: de acá en adelante no se repite lo tipeado
  });
}

async function leerPassword(): Promise<string> {
  const primera = await preguntarSinEco('Contraseña del administrador: ');
  const segunda = await preguntarSinEco('Repetí la contraseña: ');
  // Si no coinciden devuelve vacío: la validación la rechaza sin mostrar nada de lo tipeado.
  return primera === segunda ? primera : '';
}

const codigo = await ejecutarAltaUnica({
  argumentos: process.argv.slice(2),
  env: process.env,
  leerPassword,
  escribir: (texto) => console.log(texto),
}).catch((err: unknown) => {
  // Error inesperado: se muestra el mensaje, nunca datos de la entrada.
  console.error('No se pudo crear al administrador:', err instanceof Error ? err.message : 'error desconocido');
  return 1;
});

await prisma.$disconnect();
process.exit(codigo);
