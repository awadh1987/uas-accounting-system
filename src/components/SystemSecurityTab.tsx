"use client";

export { SystemTab as SystemSecurityTab, SystemTab } from "@/components/tabs/SystemTab";
export default function SystemSecurityTabDefault(props: any) {
  const { SystemTab } = require("@/components/tabs/SystemTab");
  return <SystemTab {...props} />;
}

