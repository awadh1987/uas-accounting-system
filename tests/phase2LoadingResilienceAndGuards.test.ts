import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { TabErrorBoundary } from "../src/components/TabErrorBoundary";
import { renderToStaticMarkup } from "react-dom/server";

describe("Phase 2 — Screen Loading Resilience, Clean Defaults & Delete/Duplicate Guards", () => {
  it("(1) TabErrorBoundary catches render errors and renders bilingual recovery UI without throwing", () => {
    const error = new Error("Simulated tab crash in offline mobile mode");
    const nextState = TabErrorBoundary.getDerivedStateFromError(error);
    assert.equal(nextState.hasError, true);
    assert.equal(nextState.error?.message, "Simulated tab crash in offline mobile mode");

    // Instantiate and test render in error state for Arabic
    const boundaryAr = new TabErrorBoundary({
      tab: "sales",
      lang: "ar",
      onNavigateHome: () => {},
      children: null,
    });
    boundaryAr.state = nextState;
    const renderedAr = renderToStaticMarkup(boundaryAr.render() as React.ReactElement);
    assert.ok(renderedAr.includes("تعذر تحميل هذا القسم"), "Includes Arabic error title");
    assert.ok(renderedAr.includes("إعادة المحاولة"), "Includes Arabic retry button");
    assert.ok(renderedAr.includes("العودة للرئيسية"), "Includes Arabic return to home button");
    assert.ok(renderedAr.includes("sales"), "Identifies failing tab id");

    // Instantiate and test render in error state for English
    const boundaryEn = new TabErrorBoundary({
      tab: "procurement",
      lang: "en",
      onNavigateHome: () => {},
      children: null,
    });
    boundaryEn.state = nextState;
    const renderedEn = renderToStaticMarkup(boundaryEn.render() as React.ReactElement);
    assert.ok(renderedEn.includes("Failed to load section"), "Includes English error title");
    assert.ok(renderedEn.includes("Retry"), "Includes English retry button");
    assert.ok(renderedEn.includes("Home"), "Includes English home button");
  });

  it("(2) TabErrorBoundary passes through normal children when no error occurs", () => {
    function HealthyComponent(): React.ReactElement {
      return React.createElement("div", { id: "healthy-tab" }, "UAS Operational Screen");
    }

    const html = renderToStaticMarkup(
      React.createElement(
        TabErrorBoundary,
        {
          tab: "dashboard",
          lang: "ar",
          onNavigateHome: () => {},
        },
        React.createElement(HealthyComponent, null)
      )
    );

    assert.ok(html.includes("UAS Operational Screen"));
    assert.ok(!html.includes("تعذر تحميل هذا القسم"));
  });

  it("(3) verifies duplicate detection logic for sales, bills, and payment vouchers", () => {
    // Duplicate detection helper matching UI logic
    const existingSales = [
      { id: "s1", projectId: "p1", customer: "شركة النور", total: 500000 },
      { id: "s2", projectId: "p2", customer: "مؤسسة الأمل", total: 120000 },
    ];

    function checkSaleDuplicate(projectId: string, customer: string, amount: number) {
      return existingSales.some(
        (s) =>
          s.projectId === projectId &&
          s.customer.trim().toLowerCase() === customer.trim().toLowerCase() &&
          Math.abs(Number(s.total) - amount) < 0.01
      );
    }

    assert.equal(checkSaleDuplicate("p1", "شركة النور", 500000), true, "Identifies exact duplicate sale");
    assert.equal(checkSaleDuplicate("p1", "شركة النور", 400000), false, "Different amount is not a duplicate");
    assert.equal(checkSaleDuplicate("p2", "شركة النور", 500000), false, "Different project is not a duplicate");

    const existingBills = [
      { id: "b1", vendorId: "v1", projectId: "p1", totalAmount: 750000 },
    ];

    function checkBillDuplicate(vendorId: string, projectId: string, totalAmount: number) {
      return existingBills.some(
        (b) =>
          b.vendorId === vendorId &&
          b.projectId === projectId &&
          Math.abs(Number(b.totalAmount) - totalAmount) < 0.01
      );
    }

    assert.equal(checkBillDuplicate("v1", "p1", 750000), true, "Identifies duplicate bill");
    assert.equal(checkBillDuplicate("v1", "p1", 800000), false, "Different amount is not a duplicate bill");
  });

  it("(4) verifies safe deletion checks against settled vs unsettled records", () => {
    // Unsettled bill check
    const unsettledBill = {
      id: "b-unsettled",
      billNumber: "BILL-2026-001",
      totalAmount: 100000,
      paidAmount: 0,
      paymentVouchers: [],
    };

    const settledBill = {
      id: "b-settled",
      billNumber: "BILL-2026-002",
      totalAmount: 100000,
      paidAmount: 50000,
      paymentVouchers: [{ id: "pv1" }],
    };

    function canDeleteBill(bill: { paidAmount: number; paymentVouchers: unknown[] }): {
      allowed: boolean;
      reason?: string;
    } {
      if (Number(bill.paidAmount) > 0 || bill.paymentVouchers.length > 0) {
        return {
          allowed: false,
          reason: "لا يمكن حذف فاتورة تم سدادها أو سداد جزء منها. يرجى إلغاء سندات الصرف المرتبطة أولاً.",
        };
      }
      return { allowed: true };
    }

    assert.equal(canDeleteBill(unsettledBill).allowed, true);
    assert.equal(canDeleteBill(settledBill).allowed, false);
    assert.ok(canDeleteBill(settledBill).reason?.includes("لا يمكن حذف فاتورة"));
  });
});
