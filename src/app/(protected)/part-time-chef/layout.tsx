import { RoleWorkspaceLayout } from "@/components/layout/role-workspace-layout";

export default function PartTimeChefLayout({ children }: { children: React.ReactNode }) {
  return <RoleWorkspaceLayout allowedRoles={["part_time_chef"]}>{children}</RoleWorkspaceLayout>;
}
