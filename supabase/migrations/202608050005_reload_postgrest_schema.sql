-- Refresh PostgREST's schema cache after the franchise RPCs are installed.
-- This makes new functions immediately available through Supabase's REST API.
notify pgrst, 'reload schema';
