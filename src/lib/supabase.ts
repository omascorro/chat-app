import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://yluaefxlvokvtgyjymeo.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_xPxsHzc4aqOJpWnW2Giz4w_HGg4iTfx';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
