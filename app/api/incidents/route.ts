import { NextRequest } from "next/server";
import { prisma } from "@/lib/server/db";
import { requireUser, isAuthUser, requireUserWithPermission } from "@/lib/server/auth/guard";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (!isAuthUser(user)) return user;

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10),
      MAX_LIMIT
    );
    const cursor = searchParams.get("cursor") ?? undefined;
    const from = searchParams.get("from") ?? undefined;
    const to = searchParams.get("to") ?? undefined;

    const incidents = await prisma.incident.findMany({
      where: {
        ...(from || to ? {
          createdAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to   ? { lte: new Date(to)   } : {}),
          },
        } : {}),
      },
      // Total ordering so the id-based cursor walk is stable across pages
      // (createdAt alone is non-unique and would skip/duplicate rows).
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = incidents.length > limit;
    const page = hasMore ? incidents.slice(0, limit) : incidents;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return Response.json({ data: page, meta: { nextCursor, hasMore }, error: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ data: null, meta: null, error: message }, { status: 500 });
  }
}

type IncomingIncident = {
  id?: string;
  productId?: string | null;
  productName: string;
  reason: "OUT_OF_STOCK" | "PRICE_TOO_HIGH" | "NOT_AVAILABLE" | "OTHER";
  note?: string | null;
  deviceId: string;
  createdAt?: string;
};

export async function POST(request: NextRequest) {
  const user = await requireUserWithPermission(request, 'incident.create');
  if (!isAuthUser(user)) return user;

  try {
    const body = await request.json();

    if (!Array.isArray(body)) {
      return Response.json(
        { data: null, error: "Body must be an array of incidents" },
        { status: 400 }
      );
    }

    const incoming: IncomingIncident[] = body;
    const syncedAt = new Date();

    const created = await prisma.$transaction(
      incoming.map((inc) =>
        prisma.incident.upsert({
          where: { id: inc.id ?? "" },
          update: { syncedAt },
          create: {
            ...(inc.id ? { id: inc.id } : {}),
            productId: inc.productId ?? null,
            productName: inc.productName,
            reason: inc.reason,
            note: inc.note ?? null,
            deviceId: inc.deviceId,
            createdAt: inc.createdAt ? new Date(inc.createdAt) : undefined,
            syncedAt,
          },
        })
      )
    );

    return Response.json(
      { data: { ack: (created as Array<{ id: string; syncedAt: Date | null }>).map((i) => ({ id: i.id, syncedAt: i.syncedAt })) }, error: null },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ data: null, error: message }, { status: 500 });
  }
}
