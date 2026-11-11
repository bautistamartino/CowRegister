import 'dotenv/config';
import { defineConfig } from 'vitest/config';

// Los tests usan una base SEPARADA (cowregister_test) para no tocar tus datos.
// Se arma a partir de DATABASE_URL cambiando el nombre de la base.
const urlDesarrollo = process.env.DATABASE_URL;
if (!urlDesarrollo) throw new Error('Falta DATABASE_URL en api/.env');

const url = new URL(urlDesarrollo);
url.pathname = '/cowregister_test';
const urlTest = url.toString();

// globalSetup corre en este mismo proceso, así que también ve esta variable.
process.env.DATABASE_URL = urlTest;

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/setup-global.ts'],
    env: {
      DATABASE_URL: urlTest,
      NODE_ENV: 'test',
      LIMITE_INTENTOS_LOGIN: '1000', // sin bloqueo por intentos, salvo en el test que lo prueba
    },
    // Todos los tests comparten la base de tests: se corren de a un archivo por vez.
    fileParallelism: false,
  },
});
