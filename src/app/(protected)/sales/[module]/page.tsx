import { RoleModulePage } from "@/features/modules/role-module-page";

export default async function SalesModulePage({
  params,
  searchParams,
}: {
  params: Promise<{ module: string }>;
  searchParams: Promise<{
    bookingPage?: string;
    bookingSearch?: string;
    leadPage?: string;
    leadSearch?: string;
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
      role="sales"
      slug={module}
    />
  );
}
