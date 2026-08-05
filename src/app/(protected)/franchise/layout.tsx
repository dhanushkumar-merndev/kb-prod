import { RoleWorkspaceLayout } from "@/components/layout/role-workspace-layout";

export default function FranchiseLayout({ children }: { children: React.ReactNode }) {
  return <RoleWorkspaceLayout allowedRoles={["franchise"]}>{children}</RoleWorkspaceLayout>;
}
