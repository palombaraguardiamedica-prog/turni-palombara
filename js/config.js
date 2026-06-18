// ============================================================
//  CONFIGURAZIONE — TURNI PALOMBARA
//  I valori SUPABASE_* vanno inseriti dopo aver creato il
//  progetto Supabase (Fase 2 del setup). L'anon key e' pensata
//  per stare nel frontend: la sicurezza e' garantita da login
//  Google + Row Level Security lato database.
// ============================================================
window.APP_CONFIG = {
  // --- Backend Supabase (da compilare in Fase 2) ---
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',

  // --- Admin perpetuo non eliminabile ---
  ADMIN_EMAIL: 'marabelli.s@gmail.com',

  // --- Festivi locali aggiuntivi (oltre a domeniche + festivi nazionali) ---
  //  Formato 'MM-DD'. Es. patrono di Palombara: ['09-08']
  FESTIVI_LOCALI: []
};
