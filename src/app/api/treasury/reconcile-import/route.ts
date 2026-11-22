import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction } from "@/lib/apiHelpers";
import { autoReconcileStatementRows, StatementRowInput } from "@/lib/treasury/bankWalletGateway";

export const dynamic = "force-dynamic";

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "treasury",
      action: "treasury",
    });
    if (!auth.ok) return auth.response;

    const treasuryAccountId = String(body.treasuryAccountId || "").trim();

    if (!treasuryAccountId) {
      return NextResponse.json(
        { ok: false, error: "TREASURY_ACCOUNT_ID_REQUIRED" },
        { status: 400 }
      );
    }

    let statementRows: StatementRowInput[] = [];

    if (Array.isArray(body.statementRows)) {
      statementRows = body.statementRows.map((r: any) => ({
        date: String(r.date || new Date().toISOString().slice(0, 10)),
        referenceId: r.referenceId ? String(r.referenceId).trim() : undefined,
        description: r.description ? String(r.description).trim() : undefined,
        debit: r.debit !== undefined && r.debit !== null ? Number(r.debit) : undefined,
        credit: r.credit !== undefined && r.credit !== null ? Number(r.credit) : undefined,
        balance: r.balance !== undefined && r.balance !== null ? Number(r.balance) : undefined,
      }));
    } else if (body.base64File) {
      const buffer = Buffer.from(String(body.base64File), "base64");
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);

      statementRows = rawRows.map((r) => {
        // Find date, ref, desc, debit, credit
        const dateVal = r["التاريخ"] || r["تاريخ"] || r["Date"] || r["date"] || new Date().toISOString().slice(0, 10);
        const refVal = r["المرجع"] || r["رقم الحركة"] || r["Reference"] || r["reference"] || r["Ref"] || r["ref"];
        const descVal = r["البيان"] || r["الوصف"] || r["Description"] || r["description"];
        const debitVal = r["مدين"] || r["منه"] || r["Debit"] || r["debit"];
        const creditVal = r["دائن"] || r["له"] || r["Credit"] || r["credit"];
        const balVal = r["الرصيد"] || r["Balance"] || r["balance"];

        return {
          date: String(dateVal),
          referenceId: refVal ? String(refVal).trim() : undefined,
          description: descVal ? String(descVal).trim() : undefined,
          debit: debitVal !== undefined && debitVal !== null ? Number(debitVal) : undefined,
          credit: creditVal !== undefined && creditVal !== null ? Number(creditVal) : undefined,
          balance: balVal !== undefined && balVal !== null ? Number(balVal) : undefined,
        };
      });
    } else {
      return NextResponse.json(
        { ok: false, error: "STATEMENT_ROWS_OR_FILE_REQUIRED" },
        { status: 400 }
      );
    }

    const result = await autoReconcileStatementRows({
      treasuryAccountId,
      statementRows,
    });

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "RECONCILE_IMPORT_FAILED" },
      { status: 400 }
    );
  }
});
