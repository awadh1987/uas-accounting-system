import { ClientPortalApp } from "@/components/client-portal/ClientPortalApp";

/** Compatible alias of /client/portal/ so existing links, QR codes and the APK keep working. */
export default function ClientPortalPage() {
  return <ClientPortalApp />;
}
