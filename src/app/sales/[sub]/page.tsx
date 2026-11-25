import { notFound } from "next/navigation";
import { UasAppShell } from "@/components/UasAppShell";
import { WORKSPACE_SALES_SUBSECTIONS } from "@/lib/tenant/workspaceRoutes";

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(WORKSPACE_SALES_SUBSECTIONS).map((sub) => ({ sub }));
}

/** Dedicated subdomain routes under /sales/: /sales/portal, /sales/ledgers, /sales/invoices */
export default async function WorkspaceSalesSubPage({
  params,
}: {
  params: Promise<{ sub: string }>;
}) {
  const { sub } = await params;
  if (!WORKSPACE_SALES_SUBSECTIONS[sub]) notFound();
  return <UasAppShell />;
}
