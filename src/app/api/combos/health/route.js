import { NextResponse } from "next/server";
import { getCombos, getProviderConnections } from "@/lib/localDb";
import { getCombosHealth } from "@/lib/comboHealth";
import { pingModelByKind } from "@/app/api/models/test/ping";

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

export async function POST() {
  try {
    const combos = (await getCombos()).filter((combo) => !combo.kind || combo.kind === "llm");
    const probes = await Promise.all(combos.map(async (combo) => {
      const result = await pingModelByKind(combo.name, "chat");
      return {
        id: combo.id,
        name: combo.name,
        status: result.ok ? "healthy" : "unavailable",
        latencyMs: result.latencyMs,
        error: result.error,
        checkedAt: new Date().toISOString(),
      };
    }));
    return NextResponse.json({ probes });
  } catch (error) {
    console.log("Error probing combo health:", error);
    return NextResponse.json({ error: "Failed to probe combo health" }, { status: 500 });
  }
}
