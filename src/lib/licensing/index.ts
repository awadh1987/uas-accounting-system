// Client-safe barrel: schema types, company-name lock, shared seat-binding service,
// activation policy, and Capacitor/browser offline verifier.
// (Node-only modules — verifier / hwid / guard / prismaSeatStore / companyLockServer — must be imported from their own paths.)
export * from "./licenseSchema";
export * from "./companyLock";
export * from "./seatService";
export * from "./activationPolicy";
export * from "./seatClient";
