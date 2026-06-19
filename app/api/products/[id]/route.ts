import { NextRequest } from "next/server";
import { prisma } from "@/lib/server/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, sku, barcode, sellingPrice, costPrice, lowestPrice, category, brand, specification, stockUnit, imageUrl } = body;

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
    });

    return Response.json({ data: product, error: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ data: null, error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.product.delete({ where: { id } });
    return Response.json({ data: { id }, error: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ data: null, error: message }, { status: 500 });
  }
}
