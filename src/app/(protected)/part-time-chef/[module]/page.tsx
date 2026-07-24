import { RoleModulePage } from "@/features/modules/role-module-page";

export default async function PartTimeChefModulePage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module } = await params;
  return <RoleModulePage role="part_time_chef" slug={module} />;
}
