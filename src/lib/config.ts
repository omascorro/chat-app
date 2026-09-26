export const SERVER_URL = 'wss://chat-backend-p5ny.onrender.com';
// Los archivos cifrados suben y bajan por el mismo servidor (algunas redes bloquean *.supabase.co)
export const SERVER_HTTP_URL = SERVER_URL.replace(/^wss:/, 'https:');
