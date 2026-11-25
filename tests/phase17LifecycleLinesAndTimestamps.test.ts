import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  appendCatalogBoardItemLine,
  canArchiveOrHideRequest,
  canClientCancelRequest,
  canSafelyDeleteRequest,
  computeIsolatedLineTotal,
  createBlankOrderLine,
  updateIsolatedOrderLine,
} from "../src/lib/clientPortal/orderLineBuilder";
import {
  formatIsoToDmy,
  formatIsoToDmyTime,
  formatIsoToTimeHm,
} from "../src/lib/uiFormatters";

describe("Phase 17 — Non-Merged Catalog Line Isolation, Request Lifecycle Controls & Date+Time", () => {
  it("keeps every catalog board item/grade/price selection as a separate isolated order line without merging or overwriting prices", () => {
    const gradeA = {
      id: "board-qat-a",
      inventoryItemId: "shared-inv-1",
      titleAr: "قات صعدي نخب أول",
      gradeLabel: "نخب ممتاز",
      unitCode: "QAT_BUNCH",
      unitLabel: "علاقية قات",
      unitPrice: 12000,
    };
    const gradeB = {
      id: "board-qat-b",
      inventoryItemId: "shared-inv-1",
      titleAr: "قات صعدي درجة ثانية",
      gradeLabel: "درجة ثانية",
      unitCode: "QAT_BUNCH",
      unitLabel: "علاقية قات",
      unitPrice: 8000,
    };

    const initial = [createBlankOrderLine()];
    const step1 = appendCatalogBoardItemLine(initial, gradeA, { requestedQty: 2 });
    assert.equal(step1.nextLines.length, 1);
    assert.equal(step1.nextLines[0].catalogBoardItemId, "board-qat-a");
    assert.equal(step1.nextLines[0].unitPrice, 12000);
    assert.equal(step1.nextLines[0].requestedQty, 2);

    // Adding the SAME catalog item again must stay isolated (separate line, never merged into row 0)
    const step2 = appendCatalogBoardItemLine(step1.nextLines, gradeA, { requestedQty: 3 });
    assert.equal(step2.nextLines.length, 2);
    assert.equal(step2.nextLines[0].requestedQty, 2);
    assert.equal(step2.nextLines[1].requestedQty, 3);
    assert.notEqual(step2.nextLines[0].localKey, step2.nextLines[1].localKey);

    // Adding another grade sharing the same inventoryItemId keeps its own grade/price/unit
    const step3 = appendCatalogBoardItemLine(step2.nextLines, gradeB, { requestedQty: 4 });
    assert.equal(step3.nextLines.length, 3);
    assert.equal(step3.nextLines[0].unitPrice, 12000);
    assert.equal(step3.nextLines[2].unitPrice, 8000);
    assert.equal(step3.nextLines[2].catalogBoardItemId, "board-qat-b");

    // Editing line 2's price/qty leaves lines 0 and 1 untouched
    const edited = updateIsolatedOrderLine(step3.nextLines, 2, {
      unitPrice: 8500,
      requestedQty: 5,
    });
    assert.equal(edited[0].unitPrice, 12000);
    assert.equal(edited[0].requestedQty, 2);
    assert.equal(edited[1].unitPrice, 12000);
    assert.equal(edited[1].requestedQty, 3);
    assert.equal(edited[2].unitPrice, 8500);
    assert.equal(edited[2].requestedQty, 5);
    assert.equal(computeIsolatedLineTotal(edited[2].requestedQty, edited[2].unitPrice), 42500);
  });

  it("enforces cancel, archive, hide, and safe-delete accounting guardrails", () => {
    const pendingFresh = {
      status: "PENDING_REVIEW",
      reserveStock: false,
      linkedSalesRecordId: null,
      linkedInvoiceId: null,
    };
    assert.equal(canClientCancelRequest(pendingFresh), true);
    assert.equal(canSafelyDeleteRequest(pendingFresh).allowed, true);
    assert.equal(canArchiveOrHideRequest(pendingFresh), false);

    const reservedPending = {
      status: "PENDING_REVIEW",
      reserveStock: true,
    };
    assert.equal(canClientCancelRequest(reservedPending), false);
    assert.equal(canSafelyDeleteRequest(reservedPending).allowed, false);

    const completedLinked = {
      status: "COMPLETED",
      linkedSalesRecordId: "sale-123",
      linkedInvoiceId: "inv-123",
    };
    assert.equal(canClientCancelRequest(completedLinked), false);
    assert.equal(canArchiveOrHideRequest(completedLinked), true);
    const deleteCompletedCheck = canSafelyDeleteRequest(completedLinked);
    assert.equal(deleteCompletedCheck.allowed, false);
    assert.match(deleteCompletedCheck.reason || "", /لا يمكن حذف/);

    const cancelledClean = {
      status: "CANCELLED",
      reserveStock: false,
    };
    assert.equal(canArchiveOrHideRequest(cancelledClean), true);
    assert.equal(canSafelyDeleteRequest(cancelledClean).allowed, true);
  });

  it("formats dd / mm / yyyy dates alongside HH:mm timestamps and wires portal + admin APIs cleanly", () => {
    const sampleDate = "2026-11-25T14:07:33.000Z";
    assert.equal(formatIsoToDmy(sampleDate), "25 / 11 / 2026");
    assert.equal(formatIsoToTimeHm(sampleDate), "14:07");
    assert.equal(formatIsoToDmyTime(sampleDate), "25 / 11 / 2026 — 14:07");

    const portalServiceSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/clientPortal/portalService.ts"),
      "utf8"
    );
    assert.ok(portalServiceSrc.includes("catalogBoardItemId"));
    assert.ok(portalServiceSrc.includes("lifecycleClientGoodsRequest"));
    assert.ok(portalServiceSrc.includes("bulkHideClientGoodsRequests"));
    assert.ok(portalServiceSrc.includes("createdAtDisplay"));

    const clientAppSrc = fs.readFileSync(
      path.join(process.cwd(), "src/components/client-portal/ClientPortalApp.tsx"),
      "utf8"
    );
    assert.ok(clientAppSrc.includes("appendCatalogBoardItemLine"));
    assert.ok(clientAppSrc.includes("portal-bulk-hide-completed-btn"));
    assert.ok(clientAppSrc.includes("formatIsoToDmyTime"));
  });
});
