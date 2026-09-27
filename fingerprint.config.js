// Huella nativa (runtimeVersion) de EAS Update: los comandos de package.json no afectan el codigo nativo,
// asi que cambiarlos no debe impedir que las actualizaciones lleguen a los builds instalados.
const { SourceSkips } = require('expo/fingerprint');

/** @type {import('expo/fingerprint').Config} */
const config = {
  sourceSkips: SourceSkips.PackageJsonScriptsAll,
};

module.exports = config;
