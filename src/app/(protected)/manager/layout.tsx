import { RoleWorkspaceLayout } from "@/components/layout/role-workspace-layout";

export default function ManagerLayout({ children }: { children: React.ReactNode }) {
  return <RoleWorkspaceLayout allowedRoles={["manager"]}>{children}</RoleWorkspaceLayout>;
}
