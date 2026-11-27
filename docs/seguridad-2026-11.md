# Correcciones de seguridad del cliente (rama `seguridad-cliente`, base 0dadf80)

Fecha: 2026-11-26. Despliegue: **pendiente** (nada publicado por OTA ni compilado).

## 1. Identidad y sesiones (`src/lib/client.ts`, `src/lib/crypto/sessions.ts`, `src/lib/db.ts`)

- La identidad del remitente ya no se toma del header (que llega sin autenticar). Se saca de los datos asociados de la
  sesion que logro descifrar el mensaje (`sessionPeerIdentity`), que van autenticados en cada mensaje.
- Si esa identidad no es la fijada, el mensaje se guarda cifrado en `held_inbox` y no se aplica. La sesion nueva
  tampoco se guarda. Se muestra un aviso en el chat. Al aceptar la llave (`acceptIdentity`) se abren en orden. Los
  retenidos con otra identidad se descartan. Hay un maximo de 500 retenidos por contacto.
- `acceptIdentity` y `resetSession` hacen la comprobacion y todas las escrituras bajo el candado del contacto.
- Lo recibido se escribe primero en `inbound_pending` (contenido + sesion nueva, en una sola instruccion) y despues se
  aplica. Si algo falla a la mitad, se termina (`settleInbound`) antes de volver a leer la sesion de ese contacto, al
  recibir, al enviar o al abrir la app. No se confirma al servidor hasta terminar.

**Migracion:** las tablas `inbound_pending` y `held_inbox` se crean solas al abrir la base (`CREATE TABLE IF NOT EXISTS`).
No cambia ninguna tabla existente.

**Cambio visible:** antes, un mensaje de un telefono nuevo del contacto se mostraba con un aviso. Ahora se ve despues de
aceptar la llave nueva.

## 2. Rutas y adjuntos (`src/lib/validate.ts`, `src/lib/media.ts`)

- Ids de mensajes, citas, lecturas y reacciones: solo `[A-Za-z0-9_-]{1,64}`. Usuarios: las reglas del servidor.
- Adjuntos (`cleanMediaRef`): solo se aceptan:
  - bucket `videos` o `voices`;
  - llave de 32 bytes y nonce de 24;
  - ruta `^[a-f0-9]{32}\.bin$`, la misma que sirve el servidor;
  - tamaños en rango.
- Una foto, video, nota de voz o documento sin adjunto valido se descarta.
- Las copias cifradas se guardan con un nombre aleatorio nuevo (`<32 hex>.enc`), nunca con el id del mensaje. Solo se
  leen o borran si estan dentro de `documentDirectory/media/` (`isMediaFile`).
- Los temporales descifrados usan `localFileId(id)` (hash, siempre 32 hex).
- Descargas con `createDownloadResumable`:
  - se cuentan los bytes reales y se cancela al pasar 50 MB mas el sello del cifrado;
  - al vencer el tiempo se cancela la descarga nativa;
  - en cualquier fallo se borra el archivo parcial;
  - el tamaño se revisa otra vez en disco, porque el aviso de progreso no corre en segundo plano.

**Migracion:** ninguna. Los archivos viejos (`<id>.enc`) siguen abriendo, porque la ruta guardada esta dentro de la carpeta.

## 3. Notificaciones (`src/lib/preview.ts`, `src/lib/backgroundNotifications.ts`, `targets/notification-service`)

Version 2: cada telefono crea una llave distinta para cada contacto, con un id de 8 bytes, y se la manda solo a el
(payload `nk2`).

- En el llavero compartido se guarda `pnk2_<id>` = `{k, f}`.
- Formato: `base64(0x02 | id | nonce 12 | ChaCha20-Poly1305 con AAD "aeterna-preview-v2:<id>")`, contenido `{b}`.
- El titulo sale de `f` en el llavero local, nunca del contenido. Un contacto no puede hacerse pasar por otro ni leer
  las vistas previas de los demas.
- El servidor no cambia: el formato sigue siendo base64 y su validacion lo acepta.

**Retiro de la version 1:** al abrir la app nueva, una sola vez (kv `preview_v2`):
- se borra la llave unica `pnk` del llavero;
- se borran los `peer_nk:*` y `nk_sent:*` de la base;
- desde ahi el formato viejo se muestra con el aviso generico;
- los `nk` viejos que lleguen se ignoran.

Una llave v2 se retira (se borra del llavero y se crea otra) cuando:
- se acepta una identidad nueva;
- se reinicia la sesion;
- se quita el contacto;
- se usa el boton de panico.

**Transicion:**
- Android muestra el formato nuevo en cuanto llega la OTA, porque la tarea es JavaScript.
- El iPhone muestra **el aviso generico** hasta instalar una compilacion nativa con la extension nueva. La extension vieja
  no encuentra `pnk` y deja el aviso generico; nunca se pierde el aviso.
- La carpeta `targets/` **no entra en la huella**: la OTA no la exige, asi que hay que compilar a proposito.

## 4. Respaldos (`src/lib/backup.ts`, `cleanBackupMessage` en `validate.ts`)

- Antes de leer:
  - tamaño maximo de 400 MB (el archivo entero se carga en memoria);
  - estructura revisada: formato, version, sal de 16 a 64 bytes, nonce de 24, iteraciones y datos en base64.
- Cada mensaje se valida como si llegara del otro telefono. Los invalidos se saltan y se cuentan; Ajustes dice cuantos.
- Se rechazan temporales, "ver una vez" y borrados: exportBackup nunca los incluye.
- Si el mensaje ya existe no se toca, ni su archivo.
- El archivo del respaldo:
  - va a un archivo nuevo y solo si descifra con la llave del mensaje;
  - se borra si el mensaje ya existia o si falla el guardado.
- Compatibilidad: los respaldos de cualquier version anterior siguen restaurando (prueba "respaldo cifrado").

## 5. Dependencias

`npm audit --omit=dev` paso de 19 avisos (1 critico, 9 altos) a 14 (5 altos, 9 moderados).

Se corrigieron con `npm update` de paquetes transitivos, sin `--force`:
- `shell-quote` (critico): react-native → react-devtools-core, de 1.10.0 a 1.12.0;
- `node-forge`: expo-updates → @expo/code-signing-certificates y @expo/cli, de 1.4.0 a 1.4.4;
- `brace-expansion`, `compression` y `source-map-js`.

Las huellas nativas no cambiaron (android `ebf24cc6…`, ios `f65b3b2a…`), asi que esto sale por OTA.

`npm audit fix` sin `--force` tambien subia expo-router a 57.0.32 y expo-updates a 57.0.29. Eso **cambia la huella**
(android `58012878…`, ios `d9e5f5b1…`) y exige compilaciones nuevas, por eso no se aplico.

| Aviso | Cadena | ¿En la app? | Plan |
| --- | --- | --- | --- |
| decode-uri-component ≤0.5.0 (alto) | expo-router 57 → query-string 7.1.3 | **Si**: se usa al abrir enlaces `aeterna://` | Toda la serie 57 usa query-string ^7.1.3. La correccion llega con expo-router ≥58.0.13, o sea SDK 58. Riesgo: un enlace malformado que el usuario abra puede trabar la app (no se filtra nada). |
| glob 13 / minimatch 10 (moderado) | @expo/cli, config, fingerprint, metro-config, expo-updates | No (herramientas de compilacion) | Se corrige con SDK 58. |
| zod 3 (alto) | @expo/cli | No | Se corrige con SDK 58. |
| uuid 7/8 (moderado) | xcode, @bacons/xcode (plugins) | No | Se corrige con SDK 58 y apple-targets nuevo. |

**Plan SDK 58:**
1. Seguir la guia de actualizacion de Expo (`npx expo install expo@^58 --fix`).
2. Repetir `npm audit --omit=dev`.
3. Correr `npm run test:all`.
4. Hacer **compilaciones nuevas** de Android e iOS. Cambia la huella; cuesta en EAS y hay que confirmarlo antes.
5. Aprovechar esa compilacion para la extension de iPhone (punto 3) y los parches nativos de SDK 57 que pide
   `npx expo install --check`.

## Revision del backend (sin cambios en esta rama)

- **Adjuntos por usuario:** `canAccessMedia` deja bajar (y borrar con `media-done`) a cualquier sesion un archivo sin
  fila en `media_objects` o sin destinatario. Hoy no hay ninguna fila sin destinatario (0 de 10). Las rutas tienen
  128 bits al azar y el contenido va cifrado.
  Propuesta:
  - negar si no hay fila;
  - rechazar subidas sin `X-Recipient` valido, y si es posible exigir que el destinatario sea contacto.
- **Revocacion de sesiones:**
  - Lo que esta bien: tokens de 256 bits guardados con hash; cerrar sesion borra el token; cambiar la contraseña borra
    todos; las sesiones sin uso en 90 dias se borran.
  - Lo que falta: no tienen vencimiento absoluto, iniciar sesion no cierra las demas y no hay "cerrar las otras sesiones".
  - Hoy hay 3 sesiones (una por usuario) y la mas vieja tiene 61 dias.
- **Limites de intentos:**
  - 10 fallos por usuario y 20 por IP cada 15 minutos.
  - El codigo de recuperacion tiene 48 bits y se compara con bcrypt.
  - Los contadores viven en memoria y se pierden cuando Render reinicia o duerme el servicio.
  - `getClientIp` usa la **primera** IP de `X-Forwarded-For`, que manda el cliente. Si Render agrega la real al final,
    el limite por IP (y el de registros) se puede saltar. El limite por usuario sigue funcionando. Confirmar como arma
    Render el encabezado antes de cambiarlo.
  - Fallar a proposito 10 veces bloquea 15 minutos el inicio de sesion de otro usuario.
- **Publicacion de actualizaciones EAS:**
  - `updates` no tiene `codeSigningCertificate`: cualquiera con acceso a la cuenta o a un token de Expo puede publicar
    una OTA que todos los telefonos instalan.
  - Recomendado:
    - doble factor en la cuenta de Expo;
    - revisar y revocar los tokens de acceso;
    - activar la firma de actualizaciones (expo-updates code signing). Necesita compilacion nueva, asi que conviene
      hacerlo junto con SDK 58.

## Verificacion

- `npx tsc --noEmit`: sin errores.
- `npm run test:all`: 12 de cifrado, 12 de funciones y 47 con dos telefonos; todas pasan.
- Pruebas nuevas:
  - funciones: rutas e ids, adjuntos, respaldos y sesiones;
  - dos telefonos:
    - identidad distinta retenida hasta aceptar;
    - header falso;
    - falla al guardar la sesion y reentrega;
    - ids y adjuntos invalidos;
    - limite de bytes y descarga colgada;
    - respaldo duplicado o alterado;
    - vistas previas por contacto.
- No se compilo en Android ni iOS: cuesta en EAS y el usuario lo aprueba antes. La extension Swift no se compilo
  (Windows).
