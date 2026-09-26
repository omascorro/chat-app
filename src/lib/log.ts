// En los builds de produccion no se imprime nada (los logs pueden terminar en reportes del sistema)
export function log(...args: unknown[]) {
  if (__DEV__) console.log(...args);
}
