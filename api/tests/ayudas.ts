import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

// Herramientas compartidas por todos los tests.

export const app = createApp();

// Borra todos los datos de la base de tests (no toca la estructura).
export async function limpiarBase() {
  if (!process.env.DATABASE_URL?.includes('cowregister_test')) {
    throw new Error('limpiarBase() solo puede usarse con la base de tests');
  }
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "cambios_animal", "crias_parto", "partos", "secados", "servicios", "tactos", "eventos", "semen_toros", "sesiones", "animales", "reglas_lote", "lotes", "usuarios", "establecimientos" CASCADE',
  );
}

export const PASSWORD = 'clave-de-prueba-123';

// Registra un tambo nuevo y devuelve un "agente" de supertest que guarda la cookie
// de sesión, como si fuera un navegador con el dueño logueado.
export async function registrarTambo(nombre = 'Tambo de prueba', email = 'dueno@prueba.test') {
  const agente = request.agent(app);
  const res = await agente
    .post('/api/auth/registro')
    .send({ nombreEstablecimiento: nombre, nombre: 'Dueño', email, password: PASSWORD })
    .expect(201);
  return { agente, perfil: res.body as { id: string; establecimiento: { id: string } } };
}

// Inicia sesión con un usuario existente y devuelve su agente.
export async function iniciarSesion(email: string, password = PASSWORD) {
  const agente = request.agent(app);
  await agente.post('/api/auth/login').send({ email, password }).expect(200);
  return agente;
}

// El dueño (agenteDueño) crea un usuario de su tambo con POST /api/usuarios y
// devuelve el agente de ese usuario ya logueado. Sirve para probar los permisos
// de encargado y veterinario.
export async function crearUsuario(
  agenteDueño: ReturnType<typeof request.agent>,
  rol: 'DUENO' | 'ENCARGADO' | 'VETERINARIO',
  email: string,
) {
  await agenteDueño
    .post('/api/usuarios')
    .send({ nombre: `Usuario ${rol}`, email, password: PASSWORD, rol })
    .expect(201);
  return iniciarSesion(email);
}

// Crea un animal directo con Prisma (sin pasar por la API), para preparar datos de
// los tests. Por defecto: hembra en ordeñe, sin lote ni madre. La base exige que un
// animal en BAJA tenga fechaBaja (y que solo él la tenga) y no tenga lote (spec 004), así que
// la fecha se completa sola y el lote se ignora en una baja.
export function crearAnimalDirecto(
  establecimientoId: string,
  numero: string,
  opciones: {
    sexo?: 'HEMBRA' | 'MACHO';
    estado?: 'RECIEN_NACIDO' | 'VAQUILLONA' | 'EN_ORDENE' | 'SECA' | 'BAJA';
    loteId?: string | null;
    madreId?: string | null;
    fechaNacimiento?: string | null; // AAAA-MM-DD
    motivoBaja?: 'PARTO_ANULADO' | null;
  } = {},
) {
  const estado = opciones.estado ?? 'EN_ORDENE';
  return prisma.animal.create({
    data: {
      establecimientoId,
      numero,
      sexo: opciones.sexo ?? 'HEMBRA',
      estado,
      loteId: estado === 'BAJA' ? null : (opciones.loteId ?? null),
      motivoBaja: estado === 'BAJA' ? (opciones.motivoBaja ?? null) : null,
      madreId: opciones.madreId ?? null,
      fechaNacimiento: opciones.fechaNacimiento ? new Date(`${opciones.fechaNacimiento}T00:00:00.000Z`) : null,
      fechaBaja: estado === 'BAJA' ? new Date('2026-11-01T00:00:00.000Z') : null,
    },
  });
}

// ─── Reproducción (spec 003) ────────────────────────────────────────
// Helpers que insertan directo con Prisma (sin pasar por la API), para armar los
// datos de partida de los tests.

const aFecha = (texto: string) => new Date(`${texto}T00:00:00.000Z`);

// Crea una entrada del catálogo de semen y toros.
export function crearSemenDirecto(
  establecimientoId: string,
  nombre: string,
  opciones: { raza?: string | null; activo?: boolean } = {},
) {
  return prisma.semenToro.create({
    data: { establecimientoId, nombre, raza: opciones.raza ?? null, activo: opciones.activo ?? true },
  });
}

// Momento de registro estrictamente creciente: cada evento creado con estos helpers queda
// 1 segundo después del anterior (partiendo de hace un día), así el orden de registro es el
// orden en que se llaman y nunca hay empates.
let relojHelpers = Date.now() - 24 * 60 * 60 * 1000;
function siguienteCreadoEn(): Date {
  relojHelpers += 1000;
  return new Date(relojHelpers);
}

type DatosEvento = {
  establecimientoId: string;
  animalId: string;
  registradoPorId: string;
  fecha: string; // AAAA-MM-DD
  anulacion?: { porId: string; motivo: string; en?: Date };
  creadoEn?: Date;
};

// Columnas comunes del evento (con la anulación si la hay).
function datosComunes(datos: DatosEvento, id: string, tipo: 'SERVICIO' | 'TACTO' | 'PARTO' | 'SECADO') {
  return {
    id,
    establecimientoId: datos.establecimientoId,
    animalId: datos.animalId,
    tipo,
    fecha: aFecha(datos.fecha),
    registradoPorId: datos.registradoPorId,
    creadoEn: datos.creadoEn ?? siguienteCreadoEn(),
    ...(datos.anulacion && {
      anuladoEn: datos.anulacion.en ?? new Date(),
      anuladoPorId: datos.anulacion.porId,
      motivoAnulacion: datos.anulacion.motivo,
    }),
  };
}

// Inserta un servicio: el evento común y su detalle, en una transacción.
export async function crearServicioDirecto(
  datos: DatosEvento & { tipoServicio?: 'INSEMINACION' | 'MONTA_NATURAL'; semenId?: string | null },
) {
  const id = crypto.randomUUID();
  return prisma.$transaction(async (tx) => {
    const evento = await tx.evento.create({ data: datosComunes(datos, id, 'SERVICIO') });
    await tx.servicio.create({
      data: {
        eventoId: id,
        establecimientoId: datos.establecimientoId,
        tipo: 'SERVICIO',
        tipoServicio: datos.tipoServicio ?? 'INSEMINACION',
        semenId: datos.semenId ?? null,
      },
    });
    return evento;
  });
}

// Inserta un tacto: el evento común y su detalle, en una transacción.
export async function crearTactoDirecto(
  datos: DatosEvento & {
    resultado?: 'PRENADA' | 'VACIA';
    fechaProbableIndicada?: string | null;
    anomalias?: string | null;
  },
) {
  const id = crypto.randomUUID();
  return prisma.$transaction(async (tx) => {
    const evento = await tx.evento.create({ data: datosComunes(datos, id, 'TACTO') });
    await tx.tacto.create({
      data: {
        eventoId: id,
        establecimientoId: datos.establecimientoId,
        tipo: 'TACTO',
        resultado: datos.resultado ?? 'PRENADA',
        fechaProbableIndicada: datos.fechaProbableIndicada ? aFecha(datos.fechaProbableIndicada) : null,
        anomalias: datos.anomalias ?? null,
      },
    });
    return evento;
  });
}

// ─── Partos, crías y secados (spec 004) ─────────────────────────────

// Crea un animal dado de baja (sin lote), con o sin motivo de baja.
export function crearBajaDirecta(
  establecimientoId: string,
  numero: string,
  opciones: { madreId?: string | null; motivoBaja?: 'PARTO_ANULADO' | null; sexo?: 'HEMBRA' | 'MACHO' } = {},
) {
  return crearAnimalDirecto(establecimientoId, numero, { ...opciones, estado: 'BAJA' });
}

type CriaDirecta = {
  sexo?: 'HEMBRA' | 'MACHO';
  nacidaMuerta?: boolean;
  observaciones?: string | null;
  // Cría viva: o se pasa un animal existente (animalId) o un numero y el helper lo da de alta
  // como cría recién nacida de la madre. Una cría nacida muerta no lleva ninguno.
  animalId?: string | null;
  numero?: string;
};

// Inserta un parto: el evento común, el detalle y sus crías, en una transacción. Por defecto
// una cría viva hembra con número "C<n>". La vaca no se modifica (estado y lote quedan como estén).
export async function crearPartoDirecto(
  datos: DatosEvento & {
    estadoAnterior?: 'VAQUILLONA' | 'EN_ORDENE' | 'SECA';
    tuvoLoteAnterior?: boolean;
    loteAnteriorId?: string | null;
    servicioId?: string | null;
    crias?: CriaDirecta[];
  },
) {
  const id = crypto.randomUUID();
  const crias = datos.crias ?? [{ sexo: 'HEMBRA' }];
  return prisma.$transaction(async (tx) => {
    const evento = await tx.evento.create({ data: datosComunes(datos, id, 'PARTO') });
    await tx.parto.create({
      data: {
        eventoId: id,
        establecimientoId: datos.establecimientoId,
        tipo: 'PARTO',
        madreId: datos.animalId,
        estadoAnterior: datos.estadoAnterior ?? 'EN_ORDENE',
        tuvoLoteAnterior: datos.tuvoLoteAnterior ?? datos.loteAnteriorId != null,
        loteAnteriorId: datos.loteAnteriorId ?? null,
        servicioId: datos.servicioId ?? null,
        servicioTipo: datos.servicioId ? 'SERVICIO' : null,
      },
    });
    let orden = 0;
    for (const cria of crias) {
      orden += 1;
      let animalId: string | null = null;
      if (!cria.nacidaMuerta) {
        animalId =
          cria.animalId ??
          (
            await tx.animal.create({
              data: {
                establecimientoId: datos.establecimientoId,
                numero: cria.numero ?? `C${orden}-${id.slice(0, 6).toUpperCase()}`,
                sexo: cria.sexo ?? 'HEMBRA',
                estado: 'RECIEN_NACIDO',
                madreId: datos.animalId,
                fechaNacimiento: aFecha(datos.fecha),
              },
            })
          ).id;
      }
      await tx.criaParto.create({
        data: {
          establecimientoId: datos.establecimientoId,
          eventoId: id,
          madreId: datos.animalId,
          orden,
          sexo: cria.sexo ?? 'HEMBRA',
          nacidaMuerta: cria.nacidaMuerta ?? false,
          observaciones: cria.observaciones ?? null,
          animalId,
        },
      });
    }
    return evento;
  });
}

// Inserta un secado: el evento común y su detalle, en una transacción.
export async function crearSecadoDirecto(
  datos: DatosEvento & { tuvoLoteAnterior?: boolean; loteAnteriorId?: string | null },
) {
  const id = crypto.randomUUID();
  return prisma.$transaction(async (tx) => {
    const evento = await tx.evento.create({ data: datosComunes(datos, id, 'SECADO') });
    await tx.secado.create({
      data: {
        eventoId: id,
        establecimientoId: datos.establecimientoId,
        tipo: 'SECADO',
        estadoAnterior: 'EN_ORDENE',
        tuvoLoteAnterior: datos.tuvoLoteAnterior ?? datos.loteAnteriorId != null,
        loteAnteriorId: datos.loteAnteriorId ?? null,
      },
    });
    return evento;
  });
}

// ─── Editar animal y mover de lote a mano (spec 005) ────────────────

// Inserta una fila del historial de cambios directo (sin pasar por la API). Por defecto un cambio
// de número hecho por un usuario inventado. El historial no tiene clave a usuario ni a lote.
export function crearCambioDirecto(
  establecimientoId: string,
  animalId: string,
  opciones: {
    campo?: 'NUMERO' | 'SEXO' | 'FECHA_NACIMIENTO' | 'MADRE' | 'LOTE';
    valorAnterior?: string | null;
    valorNuevo?: string | null;
    usuarioId?: string;
    usuarioNombre?: string;
    creadoEn?: Date;
  } = {},
) {
  return prisma.cambioAnimal.create({
    data: {
      establecimientoId,
      animalId,
      campo: opciones.campo ?? 'NUMERO',
      valorAnterior: opciones.valorAnterior === undefined ? 'VIEJO' : opciones.valorAnterior,
      valorNuevo: opciones.valorNuevo === undefined ? 'NUEVO' : opciones.valorNuevo,
      usuarioId: opciones.usuarioId ?? crypto.randomUUID(),
      usuarioNombre: opciones.usuarioNombre ?? 'Usuario de prueba',
      ...(opciones.creadoEn && { creadoEn: opciones.creadoEn }),
    },
  });
}

/**
 * Revisa en la base los invariantes que tienen que valer siempre, también tras operaciones
 * simultáneas (RF-33). Devuelve la lista de violaciones encontradas (vacía si todo está bien),
 * para usar así: `expect(await verificarInvariantes()).toEqual([])`.
 */
export async function verificarInvariantes(opciones: { estadoVaca?: boolean } = {}): Promise<string[]> {
  const consultas: Array<[string, string]> = [
    // RF-33 (a): dos partos no anulados de la misma vaca a menos de 200 días.
    [
      'dos partos no anulados a menos de 200 días',
      `SELECT a.id FROM eventos a JOIN eventos b ON b."animalId" = a."animalId" AND a.id < b.id
       WHERE a.tipo = 'PARTO' AND b.tipo = 'PARTO' AND a."anuladoEn" IS NULL AND b."anuladoEn" IS NULL
         AND abs(a.fecha - b.fecha) < 200`,
    ],
    // RF-33 (b): una cría de un parto anulado que sigue activa.
    [
      'cría de un parto anulado que sigue activa',
      `SELECT c.id FROM crias_parto c
       JOIN eventos e ON e.id = c."eventoId" JOIN animales a ON a.id = c."animalId"
       WHERE e."anuladoEn" IS NOT NULL AND a.estado <> 'BAJA'`,
    ],
    // RF-33 (d): si A se registró antes que B (creadoEn menor), la fecha de A no puede ser mayor.
    [
      'eventos no anulados con fechas en desorden respecto del registro',
      `SELECT a.id FROM eventos a JOIN eventos b ON b."animalId" = a."animalId"
       WHERE a."anuladoEn" IS NULL AND b."anuladoEn" IS NULL AND a."creadoEn" < b."creadoEn" AND a.fecha > b.fecha`,
    ],
    // Spec 005 RF-17 (b): no hay ciclos de madres (A madre de B y B de A, o más largos).
    // Se sube por madreId desde cada animal; si se vuelve a él mismo, hay un ciclo.
    // El tope de profundidad evita que la consulta no termine si apareciera un ciclo ajeno.
    [
      'ciclo de madres',
      `WITH RECURSIVE sube(origen, actual, profundidad) AS (
         SELECT id, "madreId", 1 FROM animales WHERE "madreId" IS NOT NULL
         UNION ALL
         SELECT s.origen, a."madreId", s.profundidad + 1 FROM sube s JOIN animales a ON a.id = s.actual
         WHERE a."madreId" IS NOT NULL AND s.profundidad < 1000)
       SELECT origen FROM sube WHERE actual = origen`,
    ],
    // Spec 005 RF-17 (c): toda madre asignada es hembra.
    [
      'madre que no es hembra',
      `SELECT a.id FROM animales a JOIN animales m ON m.id = a."madreId" WHERE m.sexo <> 'HEMBRA'`,
    ],
    ['animal de baja con lote', `SELECT id FROM animales WHERE estado = 'BAJA' AND "loteId" IS NOT NULL`],
    [
      'dos animales activos con el mismo número en un tambo',
      `SELECT "establecimientoId", numero FROM animales WHERE estado <> 'BAJA' GROUP BY 1, 2 HAVING count(*) > 1`,
    ],
    ['evento PARTO sin detalle', `SELECT e.id FROM eventos e LEFT JOIN partos p ON p."eventoId" = e.id WHERE e.tipo = 'PARTO' AND p."eventoId" IS NULL`],
    ['evento SECADO sin detalle', `SELECT e.id FROM eventos e LEFT JOIN secados s ON s."eventoId" = e.id WHERE e.tipo = 'SECADO' AND s."eventoId" IS NULL`],
    ['parto sin crías', `SELECT p."eventoId" FROM partos p LEFT JOIN crias_parto c ON c."eventoId" = p."eventoId" WHERE c.id IS NULL`],
    [
      'cría viva cuyo animal no es hijo de la madre del parto',
      `SELECT c.id FROM crias_parto c JOIN animales a ON a.id = c."animalId" WHERE a."madreId" IS DISTINCT FROM c."madreId"`,
    ],
    [
      'parto con lote previo sin indicador',
      `SELECT "eventoId" FROM partos WHERE "loteAnteriorId" IS NOT NULL AND NOT "tuvoLoteAnterior"`,
    ],
    [
      'animal activo con el motivo de baja cargado',
      `SELECT id FROM animales WHERE estado <> 'BAJA' AND "motivoBaja" IS NOT NULL`,
    ],
  ];
  // RF-33 (e): el estado de la vaca es el que dejó su último parto o secado no anulado; si todos
  // están anulados, el estado previo del más antiguo. Solo vale cuando TODOS los cambios de estado
  // pasan por la API (los datos sembrados con los helpers directos no mueven a la vaca).
  if (opciones.estadoVaca) {
    consultas.push([
      'estado de la vaca distinto del que dejó su último parto o secado',
      `WITH ev AS (
         SELECT e."animalId", e.tipo, e.fecha, e."creadoEn", (e."anuladoEn" IS NOT NULL) AS anulado,
                COALESCE(p."estadoAnterior", s."estadoAnterior")::text AS previo
         FROM eventos e LEFT JOIN partos p ON p."eventoId" = e.id LEFT JOIN secados s ON s."eventoId" = e.id
         WHERE e.tipo IN ('PARTO', 'SECADO')),
       ultimo AS (SELECT DISTINCT ON ("animalId") "animalId", tipo FROM ev WHERE NOT anulado ORDER BY "animalId", fecha DESC, "creadoEn" DESC),
       primero AS (SELECT DISTINCT ON ("animalId") "animalId", previo FROM ev ORDER BY "animalId", "creadoEn" ASC)
       SELECT a.id FROM animales a
       JOIN primero pr ON pr."animalId" = a.id
       LEFT JOIN ultimo u ON u."animalId" = a.id
       WHERE a.estado <> 'BAJA'
         AND a.estado::text <> COALESCE(CASE u.tipo WHEN 'PARTO' THEN 'EN_ORDENE' WHEN 'SECADO' THEN 'SECA' END, pr.previo)`,
    ]);
  }
  const violaciones: string[] = [];
  for (const [nombre, sql] of consultas) {
    const filas = await prisma.$queryRawUnsafe<unknown[]>(sql);
    if (filas.length > 0) violaciones.push(`${nombre} (${filas.length})`);
  }
  return violaciones;
}

// Registra un tambo con su dueño y le crea un animal (por defecto una vaca en ordeñe "101").
// Devuelve el agente del dueño, el id del tambo, el id del usuario y el animal.
export async function prepararVaca(
  opciones: Parameters<typeof crearAnimalDirecto>[2] & { numero?: string; nombreTambo?: string; email?: string } = {},
) {
  const { numero, nombreTambo, email, ...resto } = opciones;
  const { agente, perfil } = await registrarTambo(nombreTambo, email);
  const tambo = perfil.establecimiento.id;
  const vaca = await crearAnimalDirecto(tambo, numero ?? '101', resto);
  return { agente, tambo, usuarioId: perfil.id, vaca };
}
