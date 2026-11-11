// Hook PreToolUse del planificador: solo deja editar o crear archivos dentro de specs/.
// Claude Code manda por stdin un JSON con la acción; salir con código 2 la bloquea
// y el mensaje de stderr le llega al agente.
import path from 'node:path';

let entrada = '';
for await (const trozo of process.stdin) entrada += trozo;
const { tool_input: datos = {}, cwd } = JSON.parse(entrada || '{}');

const proyecto = process.env.CLAUDE_PROJECT_DIR || cwd || process.cwd();
const archivo = datos.file_path || datos.notebook_path;

if (!archivo) {
  console.error('Bloqueado: no se pudo determinar qué archivo se quiere editar.');
  process.exit(2);
}

// Normaliza rutas estilo Git Bash (/c/Users/...) a Windows (C:/Users/...)
// y, en Windows, ignora mayúsculas porque el sistema de archivos no las distingue.
function normalizar(ruta) {
  let r = String(ruta).replace(/^\/([a-zA-Z])\//, '$1:/');
  r = path.resolve(normalizarBase, r);
  return process.platform === 'win32' ? r.toLowerCase() : r;
}
const normalizarBase = String(proyecto).replace(/^\/([a-zA-Z])\//, '$1:/');

const specs = normalizar(path.join(normalizarBase, 'specs'));
const destino = normalizar(archivo);
const relativo = path.relative(specs, destino);
const dentroDeSpecs = relativo !== '' && !relativo.startsWith('..') && !path.isAbsolute(relativo);

if (!dentroDeSpecs) {
  console.error(`Bloqueado: el planificador solo puede escribir dentro de specs/. Intentó: ${archivo}`);
  process.exit(2);
}

process.exit(0);
