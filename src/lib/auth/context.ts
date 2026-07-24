import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/lib/errors";

import { authContextSchema, type AuthContext } from "./types";

export async function getMyAuthContext(supabase: SupabaseClient): Promise<AuthContext | null> {
  const { data, error } = await supabase.rpc("get_my_auth_context");

  if (error) {
    throw new AppError("INTERNAL_ERROR", { cause: error });
  }

  const rpcData: unknown = data;
  const value = Array.isArray(rpcData) ? rpcData[0] : rpcData;

  if (value === null || value === undefined) {
    return null;
  }

  const parsed = authContextSchema.safeParse(value);

  if (!parsed.success) {
    throw new AppError("INTERNAL_ERROR", {
      cause: parsed.error,
    });
  }

  return parsed.data;
}
