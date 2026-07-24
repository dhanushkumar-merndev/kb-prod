import { RoleWorkspaceLayout } from "@/components/layout/role-workspace-layout";

export default function SalesManagerLayout({ children }: { children: React.ReactNode }) {
  return <RoleWorkspaceLayout allowedRoles={["sales_manager"]}>{children}</RoleWorkspaceLayout>;
}
