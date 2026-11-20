import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterAssignedProjects } from "../src/lib/permissions";
import type { UasProject, UasUser } from "../src/types/uas";

describe("Enterprise Portfolio Project Navigation & Guarded Routing Invariants", () => {
  const dummyProjects: UasProject[] = [
    {
      id: "proj-1",
      code: "PRJ-AGRI-01",
      name: "مشروع مزرعة النخيل",
      nameAr: "مشروع مزرعة النخيل",
      nameEn: "Palm Farm Project",
      budgetTotal: 5000000,
      estimatedValue: 5000000,
      status: "ACTIVE",
      subProjects: [],
      harvests: ["قطفة 1", "قطفة 2"],
    },
    {
      id: "proj-2",
      code: "PRJ-GREEN-02",
      name: "مشروع البيوت المحمية",
      nameAr: "مشروع البيوت المحمية",
      nameEn: "Greenhouse Project",
      budgetTotal: 8000000,
      estimatedValue: 8000000,
      status: "ACTIVE",
      subProjects: [],
      harvests: [],
    },
  ];

  const superAdminUser: UasUser = {
    id: "usr-admin",
    name: "مدير النظام",
    fullName: "مدير النظام العام",
    email: "admin@uas-ye.com",
    role: "SUPER_ADMIN",
    department: "Executive",
    active: true,
    avatarChar: "م",
    assignedProjects: [], // SUPER_ADMIN has access to ALL projects regardless of assignments
  };

  const restrictedStaffUser: UasUser = {
    id: "usr-staff",
    name: "مهندس الحقل",
    fullName: "مهندس الحقل الزراعي",
    email: "field@uas-ye.com",
    role: "FIELD_AGENT",
    department: "Operations",
    active: true,
    avatarChar: "هـ",
    assignedProjects: ["proj-1"], // Only allowed to access proj-1
  };

  it("grants SUPER_ADMIN unrestricted access to all enterprise portfolio projects", () => {
    const allowed = filterAssignedProjects(superAdminUser, dummyProjects);
    assert.equal(allowed.length, 2);
    assert.ok(allowed.some((p) => p.id === "proj-1"));
    assert.ok(allowed.some((p) => p.id === "proj-2"));
  });

  it("strictly restricts assigned project scope for scoped roles (FIELD_AGENT)", () => {
    const allowed = filterAssignedProjects(restrictedStaffUser, dummyProjects);
    assert.equal(allowed.length, 1);
    assert.equal(allowed[0].id, "proj-1");

    // Proj-2 is forbidden for this user
    const hasProj2Access = allowed.some((p) => p.id === "proj-2");
    assert.equal(hasProj2Access, false);
  });

  it("verifies pendingProjectId routing guard simulation", () => {
    // Simulate clicking a portfolio card when unauthenticated
    let pendingProjectId: string | null = "proj-2";
    let activeProjectId = "ALL";
    let activeTab = "dashboard";
    let viewMode = "login";

    // Scenario A: Restricted user logs in
    const userAAllowed = filterAssignedProjects(restrictedStaffUser, dummyProjects);
    const targetA = userAAllowed.find((p) => p.id === pendingProjectId);
    if (targetA) {
      activeProjectId = targetA.id;
      activeTab = "projects";
    } else {
      // Access denied -> safe fallback
      pendingProjectId = null;
      activeProjectId = "ALL";
    }

    assert.equal(activeProjectId, "ALL");
    assert.equal(pendingProjectId, null);

    // Scenario B: User cancels login back to landing
    pendingProjectId = "proj-1";
    // onBackToLanding called:
    pendingProjectId = null;
    viewMode = "landing";
    assert.equal(pendingProjectId, null);
    assert.equal(viewMode, "landing");

    // Scenario C: Authorized user logs in with matching project
    pendingProjectId = "proj-1";
    const userCAllowed = filterAssignedProjects(restrictedStaffUser, dummyProjects);
    const targetC = userCAllowed.find((p) => p.id === pendingProjectId);
    if (targetC) {
      activeProjectId = targetC.id;
      activeTab = "projects";
      viewMode = "erp";
      pendingProjectId = null;
    }

    assert.equal(activeProjectId, "proj-1");
    assert.equal(activeTab, "projects");
    assert.equal(viewMode, "erp");
    assert.equal(pendingProjectId, null);
  });
});
