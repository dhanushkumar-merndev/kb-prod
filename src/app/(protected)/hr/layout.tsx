import { RoleWorkspaceLayout } from "@/components/layout/role-workspace-layout";

export default function HrLayout({ children }: { children: React.ReactNode }) {
  return <RoleWorkspaceLayout allowedRoles={["hr"]}>{children}</RoleWorkspaceLayout>;
}
