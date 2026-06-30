import { NextRequest } from "next/server";
import { v2 as cloudinary } from "cloudinary";
import { requireUser, isAuthUser, requireUserWithPermission } from "@/lib/server/auth/guard";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const MAX_SIZE = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: NextRequest) {
  const user = await requireUserWithPermission(request, 'catalog.product.manage');
  if (!isAuthUser(user)) return user;

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return Response.json(
        { data: null, error: "A file field named 'file' is required" },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return Response.json(
        { data: null, error: "Only image/jpeg, image/png, image/webp are allowed" },
        { status: 415 }
      );
    }

    if (file.size > MAX_SIZE) {
      return Response.json(
        { data: null, error: "File exceeds the 2 MB limit" },
        { status: 413 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "pos/products", resource_type: "image" },
        (error, result) => {
          if (error || !result) reject(error ?? new Error("Upload failed"));
          else resolve(result as { secure_url: string });
        }
      );
      stream.end(buffer);
    });

    return Response.json({ data: { url: result.secure_url }, error: null }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ data: null, error: message }, { status: 500 });
  }
}
