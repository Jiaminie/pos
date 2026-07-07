import { prisma } from "@/lib/server/db";
import { requireUser, isAuthUser } from "@/lib/server/auth/guard";

export async function GET() {
  const user = await requireUser();
  if (!isAuthUser(user)) return user;

  try {
    const rows = await prisma.product.findMany({
      where: { category: { not: null } },
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    });

    const categories = rows.map((r) => r.category as string);
    return Response.json(
      { data: { categories }, error: null },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ data: null, error: message }, { status: 500 });
  }
}
