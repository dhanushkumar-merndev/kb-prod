-- Refresh PostgREST after adding the sales compliance and manual-lead RPCs.
-- Without this notification, a running API instance can keep returning PGRST202
-- even though the functions already exist in PostgreSQL.
notify pgrst, 'reload schema';
