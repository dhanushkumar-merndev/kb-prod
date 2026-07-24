import { SessionGuard } from "@/features/auth/session-guard";
import { requireActiveSession } from "@/lib/auth/require-session";

export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await requireActiveSession();

  return <SessionGuard profile={session.profile}>{children}</SessionGuard>;
}
