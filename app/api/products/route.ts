import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { requireUser, isAuthUser, requireUserWithPermission } from "@/lib/server/auth/guard";
import { hasPermission } from "@/lib/server/auth/permissions";

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

/** SKU is globally @unique (not org-scoped), so a client-generated slug can
 *  collide with another org's product — or one not loaded locally. Detect that
 *  specific collision so we can retry with a suffix instead of 500-ing. */
function isSkuCollision(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") {
    return false
  }
  const target = err.meta?.target
  return Array.isArray(target) ? target.includes("sku") : String(target ?? "").includes("sku")
}

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

    if (!name || !sku || !brand?.trim() || sellingPrice == null) {
      return Response.json(
        { data: null, error: "name, sku, brand, sellingPrice are required" },
        { status: 400 }
      );
    }

    // Retry on a global SKU collision with a short suffix rather than failing.
    // The final sku is returned so the client can store the same value locally.
    let attemptSku: string = sku;
    for (let attempt = 0; ; attempt++) {
      try {
        const product = await prisma.product.create({
          data: {
            // Use the client-generated UUID so IDB and server share the same id.
            // Without this, the server mints a new UUID and stock transactions
            // (which reference the client UUID) become orphaned on re-sync.
            ...(id ? { id } : {}),
            name,
            sku: attemptSku,
            barcode: barcode?.trim() || null,
            brand: brand.trim().toUpperCase(),
            sellingPrice,
            // Optional: a user with product-manage + selling-price permission (but not
            // cost) can create without a cost. Defaults to 0, to be filled in later.
            costPrice: costPrice ?? 0,
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
        if (isSkuCollision(err) && attempt < 5) {
          attemptSku = `${sku}-${Math.random().toString(36).slice(2, 6)}`;
          continue;
        }
        throw err;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ data: null, error: message }, { status: 500 });
  }
}
