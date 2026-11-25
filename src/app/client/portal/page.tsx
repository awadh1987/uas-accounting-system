import { ClientPortalApp } from "@/components/client-portal/ClientPortalApp";

/** Canonical Client Portal entry: https://<slug>.qat.world/client/portal/ (`/portal` stays as a compatible alias). */
export default function ClientPortalCanonicalPage() {
  return <ClientPortalApp />;
}
