import { notFound } from "next/navigation";
import { ClientPortalApp } from "@/components/client-portal/ClientPortalApp";
import { CLIENT_PORTAL_ROUTE_SECTIONS } from "@/lib/clientPortal/portalRoutes";

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(CLIENT_PORTAL_ROUTE_SECTIONS).map((section) => ({ section }));
}

/** Compatible alias of /client/portal/<section>. */
export default async function ClientPortalSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!CLIENT_PORTAL_ROUTE_SECTIONS[section]) notFound();
  return <ClientPortalApp />;
}
