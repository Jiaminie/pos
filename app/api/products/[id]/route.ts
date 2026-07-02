import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { requireUser, isAuthUser, requireUserWithPermission } from "@/lib/server/auth/guard";
import { hasPermission } from "@/lib/server/auth/permissions";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUserWithPermission(request, 'catalog.product.manage');
  if (!isAuthUser(user)) return user;

  try {
    const { id } = await params;
    const body = await request.json();
    const { name, sku, barcode, sellingPrice, costPrice, lowestPrice, category, brand, specification, stockUnit, imageUrl, unitId } = body;

    if (sellingPrice !== undefined) {
      const ok = await hasPermission(user, 'catalog.price.selling');
      if (!ok) return Response.json({ data: null, error: 'Forbidden' }, { status: 403 });
    }
    if (costPrice !== undefined || lowestPrice !== undefined) {
      const ok = await hasPermission(user, 'catalog.price.cost_and_floor');
      if (!ok) return Response.json({ data: null, error: 'Forbidden' }, { status: 403 });
    }

    // unitId is immutable after creation — reject attempts to change it
    if (unitId !== undefined) {
      return Response.json(
        { data: null, error: 'unitId cannot be changed after product creation' },
        { status: 400 },
      );
    }

    const product = await prisma.product.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(sku !== undefined && { sku }),
        ...(barcode !== undefined && { barcode: barcode?.trim() || null }),
        ...(sellingPrice !== undefined && { sellingPrice }),
        ...(costPrice !== undefined && { costPrice }),
        ...(lowestPrice !== undefined && { lowestPrice: lowestPrice ?? null }),
        ...(category !== undefined && { category }),
        ...(brand !== undefined && { brand: brand.trim().toUpperCase() }),
        ...(specification !== undefined && { specification }),
        ...(stockUnit !== undefined && { stockUnit }),
        ...(imageUrl !== undefined && { imageUrl }),
      },
      include: { unit: true },
    });

    return Response.json({ data: product, error: null });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return Response.json({ data: null, error: "Product not found" }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ data: null, error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUserWithPermission(request, 'catalog.product.manage');
  if (!isAuthUser(user)) return user;

  try {
    const { id } = await params;
    await prisma.product.delete({ where: { id } });
    return Response.json({ data: { id }, error: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ data: null, error: message }, { status: 500 });
  }
}
