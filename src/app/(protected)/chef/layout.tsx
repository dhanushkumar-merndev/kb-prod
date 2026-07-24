import { RoleWorkspaceLayout } from "@/components/layout/role-workspace-layout";

export default function ChefLayout({ children }: { children: React.ReactNode }) {
  return <RoleWorkspaceLayout allowedRoles={["chef"]}>{children}</RoleWorkspaceLayout>;
}
