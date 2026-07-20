import { NextRequest } from "next/server";
import { prisma } from "@/lib/server/db";
import { requireUser, isAuthUser, assertBranchAccess, requirePermission } from "@/lib/server/auth/guard";
import { getTransactionPermission } from "@/lib/server/auth/transactionPermissions";

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (!isAuthUser(user)) return user;
  const denied = await requirePermission(user, 'stock.view');
  if (!isAuthUser(denied)) return denied;

  try {
    const { searchParams } = new URL(request.url);

    const limit = Math.min(
      parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10),
      MAX_LIMIT
    );
    const cursor = searchParams.get("cursor") ?? undefined;
    const productId = searchParams.get("productId") ?? undefined;
    const deviceId = searchParams.get("deviceId") ?? undefined;
    const branchId = searchParams.get("branchId") ?? undefined;
    const slim = searchParams.get("slim") === "1";
    // Incremental sync: only rows created at/after this instant. The client
    // passes the server clock from its previous pull, so it re-downloads just
    // the new tail of the append-only ledger instead of the whole history.
    const sinceRaw = searchParams.get("since");
    const since = sinceRaw ? new Date(sinceRaw) : undefined;
    const sinceValid = since && !Number.isNaN(since.getTime()) ? since : undefined;

    // Captured before the query so anything inserted while the client pages
    // through results is caught by its next incremental pull, not skipped.
    const serverTime = new Date().toISOString();

    const scopedBranch = user.role === 'OWNER' ? branchId : (user.branchId ?? branchId);

    const transactions = await prisma.inventoryTransaction.findMany({
      where: {
        ...(productId ? { productId } : {}),
        ...(deviceId ? { deviceId } : {}),
        ...(scopedBranch ? { branchId: scopedBranch } : {}),
        ...(sinceValid ? { createdAt: { gte: sinceValid } } : {}),
      },
      // Total ordering: createdAt is non-unique (imported stock txns use
      // createMany → identical Postgres now() timestamp), so the id cursor
      // needs id as a tiebreaker to walk without skipping/duplicating rows.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(slim ? {} : { include: { product: true } }),
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = transactions.length > limit;
    const page = hasMore ? transactions.slice(0, limit) : transactions;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return Response.json({
      data: page,
      meta: { nextCursor, hasMore, serverTime },
      error: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ data: null, meta: null, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (!isAuthUser(user)) return user;

  try {
    const body = await request.json();
    const { productId, type, quantity, unitPrice, deviceId, branchId } = body;

    const required = getTransactionPermission(type as string)
    if (!required) {
      return Response.json({ data: null, error: 'Invalid transaction type' }, { status: 400 })
    }
    const denied = await requirePermission(user, required)
    if (!isAuthUser(denied)) return denied

    if (!productId || !type || quantity == null || !deviceId) {
      return Response.json(
        { data: null, error: "productId, type, quantity, deviceId are required" },
        { status: 400 }
      );
    }

    const txBranch = branchId ?? user.branchId;
    if (txBranch) {
      const branchErr = assertBranchAccess(user, txBranch);
      if (branchErr) return branchErr;
    }

    const transaction = await prisma.inventoryTransaction.create({
      data: {
        productId,
        type,
        quantity,
        unitPrice: unitPrice ?? null,
        deviceId,
        branchId: txBranch ?? null,
        syncedAt: new Date(),
      },
    });
    return Response.json({ data: transaction, error: null }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ data: null, error: message }, { status: 500 });
  }
}
