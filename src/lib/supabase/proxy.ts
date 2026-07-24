import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getMyAuthContext } from "@/lib/auth/context";
import { getRoleHomePath, isRoleRouteAllowed } from "@/lib/auth/routes";
import { LOGIN_SESSION_COOKIE, validateLoginSession } from "@/lib/auth/session";

import { getPublicSupabaseEnvironment } from "./env";

function isLoginPath(pathname: string): boolean {
  return pathname === "/login" || pathname === "/login/";
}

function responseWithRedirect(
  request: NextRequest,
  response: NextResponse,
  destination: string,
): NextResponse {
  const redirectResponse = NextResponse.redirect(new URL(destination, request.url));

  response.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });

  return redirectResponse;
}

function expireAppSessionCookie(request: NextRequest, response: NextResponse): void {
  request.cookies.delete(LOGIN_SESSION_COOKIE);
  response.cookies.set(LOGIN_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function guardSupabaseSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const { url, publishableKey } = getPublicSupabaseEnvironment();
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const loginPath = isLoginPath(request.nextUrl.pathname);

  if (!user) {
    return loginPath
      ? response
      : responseWithRedirect(request, response, "/login?status=auth_required");
  }

  let profile;

  try {
    profile = await getMyAuthContext(supabase);
  } catch {
    return loginPath
      ? response
      : responseWithRedirect(request, response, "/login?status=session_check_failed");
  }

  if (!profile) {
    await supabase.auth.signOut({ scope: "local" });
    expireAppSessionCookie(request, response);

    return loginPath
      ? response
      : responseWithRedirect(request, response, "/login?status=auth_required");
  }

  if (profile.account_status !== "active") {
    await supabase.auth.signOut({ scope: "local" });
    expireAppSessionCookie(request, response);

    return responseWithRedirect(
      request,
      response,
      `/login?status=${encodeURIComponent(profile.account_status)}`,
    );
  }

  const sessionCode = request.cookies.get(LOGIN_SESSION_COOKIE)?.value;

  if (!sessionCode) {
    await supabase.auth.signOut({ scope: "local" });
    expireAppSessionCookie(request, response);

    return loginPath
      ? response
      : responseWithRedirect(request, response, "/login?status=session_expired");
  }

  const validation = await validateLoginSession(supabase, sessionCode, profile.session_version);

  if (!validation.valid) {
    if (validation.reason === "unavailable") {
      return loginPath
        ? response
        : responseWithRedirect(request, response, "/login?status=session_check_failed");
    }

    await supabase.auth.signOut({ scope: "local" });
    expireAppSessionCookie(request, response);

    return responseWithRedirect(request, response, "/login?status=session_revoked");
  }

  if (loginPath) {
    return responseWithRedirect(request, response, getRoleHomePath(profile.role));
  }

  if (!isRoleRouteAllowed(request.nextUrl.pathname, profile.role)) {
    return responseWithRedirect(request, response, getRoleHomePath(profile.role));
  }

  return response;
}
