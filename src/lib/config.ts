// Las pruebas automaticas (tests/) apuntan la app a un servidor local; en los telefonos siempre es el de Render
const testServerUrl = (globalThis as { __AETERNA_SERVER_URL__?: string }).__AETERNA_SERVER_URL__;

export const SERVER_URL = testServerUrl ?? 'wss://chat-backend-p5ny.onrender.com';
// Los archivos cifrados suben y bajan por el mismo servidor (algunas redes bloquean *.supabase.co)
export const SERVER_HTTP_URL = SERVER_URL.replace(/^ws(s?):/, 'http$1:');
