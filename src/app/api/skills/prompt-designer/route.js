import { NextResponse } from "next/server";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";

const DEFAULT_MODEL = "gemini/gemini-flash";

const UX_SYSTEM_PROMPT = `You are a UI/UX prompt designer. Turn the user's product request into one precise implementation prompt for a coding agent.

Use this workflow:
1. Extract goal, product, platform, stack, audience, and style constraints. Do not invent missing business requirements.
2. Define a small design system: visual direction, layout pattern, color roles with accessible contrast, typography, spacing scale, border radius, elevation, icon approach, and responsive behavior.
3. Specify page structure, component hierarchy, states, interactions, content requirements, and implementation details for the requested stack.
4. Finish with a QA checklist covering responsive layout, keyboard access, visible focus, touch targets, contrast, loading/empty/error states, and icon legibility.

Rules:
- Prefer native platform features and existing dependencies.
- Use real icon components, never emoji or improvised SVG when an icon library is available.
- Avoid gradients unless explicitly requested.
- Keep output concrete enough for an agent to implement without another design discussion.
- Return only the final implementation prompt. No preamble, JSON wrapper, or explanation.`;

function value(input, fallback = "not specified") {
  return typeof input === "string" && input.trim() ? input.trim() : fallback;
}

export function buildPrompt(input) {
  const {
    goal,
    product,
    stack,
    platform,
    styleKeywords,
    audience,
    existingFiles,
  } = input;

  return `Create the UI/UX implementation for this request.

Goal: ${value(goal)}
Product: ${value(product)}
Platform: ${value(platform)}
Stack: ${value(stack)}
Audience: ${value(audience)}
Style keywords: ${value(styleKeywords)}
Existing files or constraints: ${value(existingFiles)}

Write one complete implementation prompt for a coding agent. Include the design system, page structure, component behavior, responsive rules, accessibility requirements, and QA checklist.`;
}

export async function POST(request) {
  try {
    const body = await request.json();

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
    }

    if (!value(body.goal, "")) {
      return NextResponse.json({ error: "Missing required field: goal" }, { status: 400 });
    }

    await initTranslators();

    const upstreamBody = {
      model: body.model || DEFAULT_MODEL,
      messages: [
        { role: "system", content: UX_SYSTEM_PROMPT },
        { role: "user", content: buildPrompt(body) },
      ],
      stream: false,
    };

    const headers = new Headers({ "content-type": "application/json" });
    const authorization = request.headers.get("authorization");
    if (authorization) headers.set("authorization", authorization);

    const upstreamRequest = new Request(request.url, {
      method: "POST",
      headers,
      body: JSON.stringify(upstreamBody),
    });

    const response = await handleChat(upstreamRequest);
    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    const prompt = data?.choices?.[0]?.message?.content;
    if (typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json({ error: "Provider returned no prompt" }, { status: 502 });
    }

    return NextResponse.json({
      prompt: prompt.trim(),
      model: upstreamBody.model,
    });
  } catch (error) {
    console.error("Prompt designer error:", error);
    return NextResponse.json(
      { error: error.message || "Prompt designer failed" },
      { status: 500 }
    );
  }
}