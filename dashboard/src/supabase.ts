import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://wbzzoxsynasqkcqcflbw.supabase.co';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_AswlLl9UI0MlPkp8w7uSVg_LWpYNslG';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
