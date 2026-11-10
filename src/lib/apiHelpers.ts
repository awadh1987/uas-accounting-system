import { NextResponse } from "next/server";

export interface ActorPayload {
  userId?: string | null;
  userDisplay?: string;
  userRole?: string;
}

export function extractActor(body: Record<string, unknown>): {
  userId: string | null;
  userDisplay: string;
  userRole: string;
} {
  const actor = (body.actor as ActorPayload | undefined) || {};
  return {
    userId: actor.userId ?? "u1",
    userDisplay: actor.userDisplay || "أحمد الجابري (Admin)",
    userRole: actor.userRole || "مدير النظام (Admin)",
  };
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function lockedError() {
  return NextResponse.json(
    {
      error: "🔒 هذه القطفة مغلقة محاسبياً! لا يمكن التعديل أو الحذف إلا بعد فتح القطفة أو عبر قيد تسوية",
      code: "HARVEST_LOCKED",
    },
    { status: 423 }
  );
}

