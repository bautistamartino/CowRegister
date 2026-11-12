// Genera los íconos PNG de la app (web/public/icono-*.png) sin dependencias.
// Se corre una sola vez (node web/scripts/generar-iconos.mjs) y los PNG se commitean.
// Dibujo: fondo verde del tambo y, al centro, un círculo blanco con un círculo verde adentro.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERDE = [0x2f, 0x6b, 0x45];
const BLANCO = [0xff, 0xff, 0xff];

// CRC32 que exige el formato PNG en cada bloque.
const tabla = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = tabla[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function bloque(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

// `escala` es el tamaño del dibujo respecto del ícono: el "maskable" lo achica para que quede
// dentro de la zona segura (el sistema puede recortar los bordes con una máscara redonda).
function png(tam, escala) {
  const filas = [];
  const c = tam / 2;
  const radioExterior = (tam / 2) * escala * 0.8;
  const radioInterior = radioExterior * 0.55;
  for (let y = 0; y < tam; y++) {
    const fila = Buffer.alloc(1 + tam * 3); // 1 byte de filtro (0) + RGB por píxel
    for (let x = 0; x < tam; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      const color = d <= radioInterior ? VERDE : d <= radioExterior ? BLANCO : VERDE;
      fila.set(color, 1 + x * 3);
    }
    filas.push(fila);
  }
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(tam, 0);
  cabecera.writeUInt32BE(tam, 4);
  cabecera.set([8, 2, 0, 0, 0], 8); // 8 bits, color RGB, sin interlazado
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque('IHDR', cabecera),
    bloque('IDAT', deflateSync(Buffer.concat(filas))),
    bloque('IEND', Buffer.alloc(0)),
  ]);
}

const carpeta = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(carpeta, { recursive: true });
writeFileSync(join(carpeta, 'icono-192.png'), png(192, 1));
writeFileSync(join(carpeta, 'icono-512.png'), png(512, 1));
writeFileSync(join(carpeta, 'icono-maskable-512.png'), png(512, 0.75));
console.log('Íconos generados en', carpeta);
