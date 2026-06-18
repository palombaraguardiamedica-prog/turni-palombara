// ============================================================
//  CONFIGURAZIONE — TURNI PALOMBARA
//  I valori SUPABASE_* vanno inseriti dopo aver creato il
//  progetto Supabase (Fase 2 del setup). L'anon key e' pensata
//  per stare nel frontend: la sicurezza e' garantita da login
//  Google + Row Level Security lato database.
// ============================================================
window.APP_CONFIG = {
  // --- Backend Supabase ---
  SUPABASE_URL: 'https://wwnmayddwsdtjxowwxge.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3bm1heWRkd3NkdGp4b3d3eGdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3OTI4OTYsImV4cCI6MjA5NzM2ODg5Nn0.VXy-2Hc8iY0UXXHxphzlRCYZGFDbSvknW8DFhuxL2oY',

  // --- Admin perpetuo non eliminabile ---
  ADMIN_EMAIL: 'marabelli.s@gmail.com',

  // --- Festivi locali aggiuntivi (oltre a domeniche + festivi nazionali) ---
  //  Formato 'MM-DD'. Es. patrono di Palombara: ['09-08']
  FESTIVI_LOCALI: []
};
