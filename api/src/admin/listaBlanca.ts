// Lista blanca de lo que el administrador puede ver (spec 014, excepción acotada al principio 1 de la
// constitución). Las respuestas de /api/admin se arman con SOLO estas claves; los tests comparan las
// claves de cada respuesta con estas constantes.

// Perfil del administrador logueado.
export const CLAVES_PERFIL_ADMIN = ['id', 'nombre', 'email'] as const;

// Un tambo en el listado: dueño = el usuario DUENO más antiguo; duenosAdicionales = cuántos otros dueños hay.
export const CLAVES_ITEM_LISTADO = [
  'id',
  'nombre',
  'creadoEn',
  'dueno',
  'duenosAdicionales',
  'usuariosActivos',
  'animalesActivos',
] as const;

// Un usuario dentro del detalle (todos, activos o no).
export const CLAVES_USUARIO_DETALLE = ['nombre', 'email', 'rol', 'activo'] as const;

// El detalle es el ítem del listado más la lista de usuarios.
export const CLAVES_DETALLE = [...CLAVES_ITEM_LISTADO, 'usuarios'] as const;

// `select` de Prisma: pedimos campo por campo, nunca un objeto entero, así un campo nuevo en la tabla
// (por ejemplo passwordHash) jamás llega a una respuesta del administrador por descuido.
export const SELECT_PERFIL_ADMIN = { id: true, nombre: true, email: true } as const;
// creadoEn se pide solo para ordenar los usuarios y elegir al dueño más antiguo; no se devuelve.
export const SELECT_USUARIO_DETALLE = { nombre: true, email: true, rol: true, activo: true, creadoEn: true } as const;
