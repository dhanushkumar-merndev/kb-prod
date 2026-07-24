import { RoleModulePage } from "@/features/modules/role-module-page";

export default async function ChefModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  return <RoleModulePage role="chef" slug={module} />;
}
