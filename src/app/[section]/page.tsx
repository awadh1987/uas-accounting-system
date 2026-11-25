import { notFound } from "next/navigation";
import { UasAppShell } from "@/components/UasAppShell";
import { WORKSPACE_ROUTE_SECTIONS } from "@/lib/tenant/workspaceRoutes";

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(WORKSPACE_ROUTE_SECTIONS).map((section) => ({ section }));
}

/** Dedicated tenant workspace sub-paths: /harvest, /commercial, /inbound-outbound, /payments, etc. */
export default async function WorkspaceSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!WORKSPACE_ROUTE_SECTIONS[section]) notFound();
  return <UasAppShell />;
}
