import { NextResponse } from "next/server";
import { getCombos, getProviderConnections } from "@/lib/localDb";
import { getCombosHealth } from "@/lib/comboHealth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [combos, connections] = await Promise.all([
      getCombos(),
      getProviderConnections(),
    ]);
    return NextResponse.json({ health: getCombosHealth(combos, connections) });
  } catch (error) {
    console.log("Error fetching combo health:", error);
    return NextResponse.json({ error: "Failed to fetch combo health" }, { status: 500 });
  }
}