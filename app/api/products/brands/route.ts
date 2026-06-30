import { prisma } from "@/lib/server/db";
import { requireUser, isAuthUser } from "@/lib/server/auth/guard";

export async function GET() {
  const user = await requireUser();
  if (!isAuthUser(user)) return user;

  try {
    const rows = await prisma.product.findMany({
      where: { brand: { not: "" } },
      select: { brand: true },
      distinct: ["brand"],
      orderBy: { brand: "asc" },
    });

    const brands = rows.map((r) => r.brand).filter(Boolean);

    return Response.json(
      { data: { brands }, error: null },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ data: null, error: message }, { status: 500 });
  }
}
