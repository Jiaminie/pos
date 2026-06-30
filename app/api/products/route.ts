import { NextRequest } from "next/server";
import { prisma } from "@/lib/server/db";
import { requireUser, isAuthUser, requireUserWithPermission } from "@/lib/server/auth/guard";
import { hasPermission } from "@/lib/server/auth/permissions";

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

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
    const category = searchParams.get("category") ?? undefined;
    const brand = searchParams.get("brand") ?? undefined;
    const search = searchParams.get("search") ?? undefined;

    const where = {
      ...(category ? { category } : {}),
      ...(brand ? { brand: { equals: brand, mode: "insensitive" as const } } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { sku: { contains: search, mode: "insensitive" as const } },
              { brand: { contains: search, mode: "insensitive" as const } },
              { barcode: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const products = await prisma.product.findMany({
      where,
      // createdAt is non-unique — bulk imports use createMany, and Postgres
      // now() returns the transaction timestamp, so an entire import batch
      // shares one identical created_at. Ordering by createdAt alone is not a
      // total order, so the id-based cursor walk skips/duplicates rows across
      // page boundaries non-deterministically (different counts per device —
      // catalog "drift"). Add id as a tiebreaker for a stable total ordering.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = products.length > limit;
    const page = hasMore ? products.slice(0, limit) : products;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    // Total count on first page only — used for sync progress UI
    const total =
      !cursor && !category && !brand && !search
        ? await prisma.product.count({ where })
        : undefined;

    return Response.json(
      { data: page, meta: { nextCursor, hasMore, total }, error: null },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ data: null, meta: null, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await requireUserWithPermission(request, 'catalog.product.manage');
  if (!isAuthUser(user)) return user;

  try {
    const body = await request.json();
    const { id, name, sku, barcode, sellingPrice, costPrice, lowestPrice, imageUrl, category, brand, specification, stockUnit, unitId } = body;

    if (sellingPrice !== undefined && sellingPrice !== null) {
      const ok = await hasPermission(user, 'catalog.price.selling');
      if (!ok) return Response.json({ data: null, error: 'Forbidden' }, { status: 403 });
    }
    if (costPrice !== undefined || lowestPrice !== undefined) {
      const ok = await hasPermission(user, 'catalog.price.cost_and_floor');
      if (!ok) return Response.json({ data: null, error: 'Forbidden' }, { status: 403 });
    }

    if (!name || !sku || !brand?.trim() || sellingPrice == null || costPrice == null) {
      return Response.json(
        { data: null, error: "name, sku, brand, sellingPrice, costPrice are required" },
        { status: 400 }
      );
    }

    const product = await prisma.product.create({
      data: {
        // Use the client-generated UUID so IDB and server share the same id.
        // Without this, the server mints a new UUID and stock transactions
        // (which reference the client UUID) become orphaned on re-sync.
        ...(id ? { id } : {}),
        name,
        sku,
        barcode: barcode?.trim() || null,
        brand: brand.trim().toUpperCase(),
        sellingPrice,
        costPrice,
        lowestPrice: lowestPrice ?? null,
        imageUrl: imageUrl ?? null,
        category: category ?? null,
        specification: specification ?? null,
        stockUnit: stockUnit ?? null,
        ...(unitId ? { unitId } : {}),
        organizationId: user.orgId,
      },
      include: { unit: true },
    });
    return Response.json({ data: product, error: null }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ data: null, error: message }, { status: 500 });
  }
}
