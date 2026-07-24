import { RoleWorkspaceLayout } from "@/components/layout/role-workspace-layout";

export default function SalesLayout({ children }: { children: React.ReactNode }) {
  return <RoleWorkspaceLayout allowedRoles={["sales"]}>{children}</RoleWorkspaceLayout>;
}
