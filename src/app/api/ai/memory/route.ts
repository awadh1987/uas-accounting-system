/**
 * UAS Enterprise — Tenant-Scoped Copilot Memory API (/api/ai/memory)
 *
 * Allows reading, manual creation, pinning, active toggling, deletion, undo,
 * and offline-to-online sync of Copilot memories strictly inside the caller's
 * authenticated tenant workspace.
 */
import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { getActiveTenantId } from "@/lib/tenant/tenantContext";
import { isReadOnly } from "@/lib/permissions";
import {
  countLearnedDialectEntries,
  deleteTenantMemory,
  getUserDialectLearningEnabled,
  listVisibleTenantMemories,
  resetLearnedDialectForUser,
  setUserDialectLearningEnabled,
  updateTenantMemory,
  upsertTenantMemory,
} from "@/lib/ai/copilotMemoryStore";
import {
  isDialectLearningConfigEntry,
  normalizeMemoryTenantSlug,
  type CopilotMemoryCategory,
  type CopilotMemoryEntry,
  type CopilotMemoryScope,
} from "@/lib/ai/copilotMemoryTypes";

export const dynamic = "force-dynamic";

function resolveRequestTenantSlug(): string {
  return normalizeMemoryTenantSlug(getActiveTenantId());
}

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    const auth = await authorizeApiAction({}, req, {});
    if (!auth.ok) return auth.response;
    const actor = auth.actor;
    const tenantSlug = resolveRequestTenantSlug();
    const includeInactive = req.nextUrl?.searchParams.get("includeInactive") === "true";

    const memories = listVisibleTenantMemories({
      tenantSlug,
      userId: actor.userId,
      includeInactive,
    });
    const dialectLearningEnabled = getUserDialectLearningEnabled({
      tenantSlug,
      userId: actor.userId,
    });
    const learnedDialectCount = countLearnedDialectEntries({
      tenantSlug,
      userId: actor.userId,
    });

    return NextResponse.json({
      success: true,
      tenantSlug,
      dialectLearningEnabled,
      learnedDialectCount,
      memories,
    });
  } catch (err: unknown) {
    console.error("GET /api/ai/memory error:", err);
    return jsonError("تعذر تحميل ذاكرة المساعد الذكي / Failed to load Copilot memories", 500);
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {});
    if (!auth.ok) return auth.response;
    const actor = auth.actor;
    const tenantSlug = resolveRequestTenantSlug();
    const action = String(body.action || "upsert").toLowerCase();

    const targetScope: CopilotMemoryScope = body.scope === "user" ? "user" : "workspace";
    const actorReadOnly = isReadOnly(actor.user || actor.userRole);

    if (action === "set_dialect_learning") {
      const enabled = body.enabled !== false;
      setUserDialectLearningEnabled({
        tenantSlug,
        userId: actor.userId,
        enabled,
      });
      return NextResponse.json({
        success: true,
        tenantSlug,
        dialectLearningEnabled: enabled,
        learnedDialectCount: countLearnedDialectEntries({
          tenantSlug,
          userId: actor.userId,
        }),
        memories: listVisibleTenantMemories({
          tenantSlug,
          userId: actor.userId,
          includeInactive: true,
        }),
      });
    }

    if (action === "reset_dialect") {
      const resetRes = resetLearnedDialectForUser({
        tenantSlug,
        userId: actor.userId,
      });
      return NextResponse.json({
        success: true,
        tenantSlug,
        removedCount: resetRes.removedCount,
        dialectLearningEnabled: getUserDialectLearningEnabled({
          tenantSlug,
          userId: actor.userId,
        }),
        learnedDialectCount: 0,
        memories: resetRes.memories,
      });
    }

    if (action === "sync" && Array.isArray(body.entries)) {
      const synced: CopilotMemoryEntry[] = [];
      for (const rawEntry of body.entries as Array<Partial<CopilotMemoryEntry>>) {
        if (isDialectLearningConfigEntry({ topicKey: String(rawEntry.topicKey || "") })) {
          continue;
        }
        const scope: CopilotMemoryScope = rawEntry.scope === "user" ? "user" : "workspace";
        if (actorReadOnly && scope === "workspace") continue;
        const ev = upsertTenantMemory({
          id: rawEntry.id,
          tenantSlug, // strictly enforce server-resolved tenantSlug (ignore any spoofed slug)
          scope,
          userId: scope === "user" ? actor.userId ?? undefined : undefined,
          category: (rawEntry.category || "domain_fact") as CopilotMemoryCategory,
          topicKey: String(rawEntry.topicKey || rawEntry.content || "rule"),
          content: String(rawEntry.content || ""),
          sourceSnippet: rawEntry.sourceSnippet,
          confidence: rawEntry.confidence,
          pinned: Boolean(rawEntry.pinned),
          active: rawEntry.active !== false,
        });
        if (ev) synced.push(ev.entry);
      }
      return NextResponse.json({
        success: true,
        tenantSlug,
        syncedCount: synced.length,
        dialectLearningEnabled: getUserDialectLearningEnabled({
          tenantSlug,
          userId: actor.userId,
        }),
        learnedDialectCount: countLearnedDialectEntries({
          tenantSlug,
          userId: actor.userId,
        }),
        memories: listVisibleTenantMemories({ tenantSlug, userId: actor.userId, includeInactive: true }),
      });
    }

    if (actorReadOnly && targetScope === "workspace") {
      return jsonError(
        "⛔ صلاحيتك للقراءة فقط ولا يمكن تعديل ذاكرة المنشأة المشتركة / Read-only users can only manage personal user preferences.",
        403
      );
    }

    if (action === "delete" || action === "undo") {
      const id = String(body.id || "").trim();
      if (!id) return jsonError("معرف الذاكرة مطلوب / Memory ID required", 400);
      const removed = deleteTenantMemory({ tenantSlug, id });
      if (action === "undo" && body.previousEntry && typeof body.previousEntry === "object") {
        const prev = body.previousEntry as CopilotMemoryEntry;
        upsertTenantMemory({
          ...prev,
          tenantSlug, // enforce tenant isolation
        });
      }
      return NextResponse.json({
        success: true,
        tenantSlug,
        removed,
        dialectLearningEnabled: getUserDialectLearningEnabled({
          tenantSlug,
          userId: actor.userId,
        }),
        learnedDialectCount: countLearnedDialectEntries({
          tenantSlug,
          userId: actor.userId,
        }),
        memories: listVisibleTenantMemories({ tenantSlug, userId: actor.userId, includeInactive: true }),
      });
    }

    if (action === "update" || action === "toggle" || action === "pin") {
      const id = String(body.id || "").trim();
      if (!id) return jsonError("معرف الذاكرة مطلوب / Memory ID required", 400);
      const updated = updateTenantMemory({
        tenantSlug,
        id,
        patch: {
          ...(body.active !== undefined ? { active: Boolean(body.active) } : {}),
          ...(body.pinned !== undefined ? { pinned: Boolean(body.pinned) } : {}),
          ...(typeof body.content === "string" && body.content.trim()
            ? { content: body.content.trim() }
            : {}),
        },
      });
      if (!updated) return jsonError("السجل غير موجود في ذاكرة المنشأة", 404);
      return NextResponse.json({
        success: true,
        tenantSlug,
        memory: updated,
        dialectLearningEnabled: getUserDialectLearningEnabled({
          tenantSlug,
          userId: actor.userId,
        }),
        learnedDialectCount: countLearnedDialectEntries({
          tenantSlug,
          userId: actor.userId,
        }),
        memories: listVisibleTenantMemories({ tenantSlug, userId: actor.userId, includeInactive: true }),
      });
    }

    // Default: upsert new or existing memory entry
    const content = String(body.content || "").trim();
    if (!content) return jsonError("يرجى كتابة القاعدة أو المعلومة المراد حفظها", 400);

    const ev = upsertTenantMemory({
      id: typeof body.id === "string" ? body.id : undefined,
      tenantSlug,
      scope: targetScope,
      userId: targetScope === "user" ? actor.userId ?? undefined : undefined,
      category: (body.category || "domain_fact") as CopilotMemoryCategory,
      topicKey: String(body.topicKey || content),
      content,
      sourceSnippet: typeof body.sourceSnippet === "string" ? body.sourceSnippet : content,
      confidence: typeof body.confidence === "number" ? body.confidence : 0.95,
      pinned: Boolean(body.pinned),
      active: body.active !== false,
    });

    if (!ev) {
      return jsonError(
        "⚠️ تعذر حفظ المعلومة لأنها تخالف ضوابط الأمان أو تحتوي بيانات حساسة / Memory rejected by safety guardrails.",
        400
      );
    }

    return NextResponse.json({
      success: true,
      tenantSlug,
      event: ev,
      dialectLearningEnabled: getUserDialectLearningEnabled({
        tenantSlug,
        userId: actor.userId,
      }),
      learnedDialectCount: countLearnedDialectEntries({
        tenantSlug,
        userId: actor.userId,
      }),
      memories: listVisibleTenantMemories({ tenantSlug, userId: actor.userId, includeInactive: true }),
    });
  } catch (err: unknown) {
    console.error("POST /api/ai/memory error:", err);
    return jsonError("تعذر تحديث ذاكرة المساعد / Failed to update Copilot memory", 500);
  }
});
