import type { NextRequest } from "next/server";

import { guardSupabaseSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return guardSupabaseSession(request);
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
