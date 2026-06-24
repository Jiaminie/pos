import { NextRequest } from "next/server";
import { prisma } from "@/lib/server/db";

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export async function GET(request: NextRequest) {
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
    // slim=1 omits the joined product — used by full-log device sync, where
    // embedding a product per row would bloat the download enormously.
    const slim = searchParams.get("slim") === "1";

    const transactions = await prisma.inventoryTransaction.findMany({
      where: {
        ...(productId ? { productId } : {}),
        ...(deviceId ? { deviceId } : {}),
        // Per-branch sync also pulls legacy rows that predate branch tagging.
        ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
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
      meta: { nextCursor, hasMore },
      error: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ data: null, meta: null, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { productId, type, quantity, unitPrice, deviceId } = body;

    if (!productId || !type || quantity == null || !deviceId) {
      return Response.json(
        { data: null, error: "productId, type, quantity, deviceId are required" },
        { status: 400 }
      );
    }

    const transaction = await prisma.inventoryTransaction.create({
      data: {
        productId,
        type,
        quantity,
        unitPrice: unitPrice ?? null,
        deviceId,
        syncedAt: new Date(),
      },
    });
    return Response.json({ data: transaction, error: null }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ data: null, error: message }, { status: 500 });
  }
}
