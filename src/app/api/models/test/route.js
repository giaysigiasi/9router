import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const body = await request.json();
    const { model, messages = [] } = body;

    if (!model) {
      return NextResponse.json({ error: "Model required" }, { status: 400 });
    }

    // Simulate test latency between 200-800ms
    const latency = Math.floor(Math.random() * 600) + 200;
    await new Promise((resolve) => setTimeout(resolve, latency));

    // Mock successful test response
    return NextResponse.json({
      success: true,
      model,
      latency,
      status: "ok",
      response: "Test successful. Model is reachable.",
      usage: {
        prompt_tokens: messages.length > 0 ? 10 : 0,
        completion_tokens: 8,
        total_tokens: messages.length > 0 ? 18 : 8,
      },
    });
  } catch (error) {
    console.log("Error testing model:", error);
    return NextResponse.json(
      { error: "Failed to test model", details: error.message },
      { status: 500 }
    );
  }
}