import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/analytics/admin-auth";

/**
 * Whether the bearer of this ID token is an admin. Lets the UI show admin
 * entry points; every admin API still verifies the token itself.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const check = await verifyAdmin(request);
  return NextResponse.json(
    { admin: check.ok },
    { headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } },
  );
}
