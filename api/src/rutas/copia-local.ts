import { Router } from 'express';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { requiereSesion, usuarioActual } from '../auth/middleware.js';
import { armarCopiaLocal } from '../copia/copiaLocal.js';

// Copia local del tambo para el modo sin conexión (spec 009). Solo lectura, los tres roles; sin
// sesión es 401 (también controlado en app.ts antes de los parsers). El tambo sale SIEMPRE de la
// sesión: cualquier `establecimientoId` de la consulta se ignora (RF-49, RF-50).
export const rutasCopiaLocal = Router();
rutasCopiaLocal.use(requiereSesion);

const comprimir = promisify(gzip); // asíncrono: un gzip de decenas de MB no debe frenar a los demás pedidos

// GET /api/copia-local
rutasCopiaLocal.get('/', async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const resultado = await armarCopiaLocal(establecimientoId);

  // Más animales activos que el tope: nada se recorta ni se descarga (RF-8).
  if (resultado.excedido) {
    res.status(422).json({
      error: `El tambo tiene más animales de los que entran en la tablet (${resultado.tope}). Pedí ayuda para usarlo sin conexión`,
      totalAnimales: resultado.totalAnimales,
      tope: resultado.tope,
    });
    return;
  }

  // La copia pesa mucho (JSON repetitivo): se comprime con gzip si el cliente lo acepta.
  const cuerpo = Buffer.from(JSON.stringify(resultado.copia));
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store'); // datos del tambo: nunca en cachés compartidos
  res.setHeader('Vary', 'Accept-Encoding');
  if (req.acceptsEncodings('gzip')) {
    res.setHeader('Content-Encoding', 'gzip');
    res.send(await comprimir(cuerpo));
  } else {
    res.send(cuerpo);
  }
});
