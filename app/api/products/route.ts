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
            ],
          }
        : {}),
    };

    const products = await prisma.product.findMany({
      where,
      orderBy: { createdAt: "desc" },
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
  try {
    const body = await request.json();
    const { id, name, sku, sellingPrice, costPrice, lowestPrice, imageUrl, category, brand, specification, stockUnit } = body;

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
        brand: brand.trim().toUpperCase(),
        sellingPrice,
        costPrice,
        lowestPrice: lowestPrice ?? null,
        imageUrl: imageUrl ?? null,
        category: category ?? null,
        specification: specification ?? null,
        stockUnit: stockUnit ?? null,
      },
    });
    return Response.json({ data: product, error: null }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ data: null, error: message }, { status: 500 });
  }
}
