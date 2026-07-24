import { RoleModulePage } from "@/features/modules/role-module-page";

export default async function SalesManagerModulePage({
  params,
  searchParams,
}: {
  params: Promise<{ module: string }>;
  searchParams: Promise<{
    bookingPage?: string;
    bookingSearch?: string;
    leadPage?: string;
    leadSearch?: string;
    teamPage?: string;
    teamSearch?: string;
  }>;
}) {
  const { module } = await params;
  const query = await searchParams;
  return (
    <RoleModulePage
      bookingPage={Number(query.bookingPage) || 1}
      bookingSearch={query.bookingSearch}
      leadPage={Number(query.leadPage) || 1}
      leadSearch={query.leadSearch}
      role="sales_manager"
      slug={module}
      teamPage={Number(query.teamPage) || 1}
      teamSearch={query.teamSearch}
    />
  );
}
