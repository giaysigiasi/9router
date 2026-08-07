import { NextResponse } from "next/server";

// Mock data - in a real app, this would be generated dynamically
const mockHealthData = [
  {
    name: "OpenAI",
    status: "healthy",
    latency: 120,
    errorRate: 0.5,
  },
  {
    name: "Anthropic",
    status: "healthy",
    latency: 150,
    errorRate: 0.2,
  },
  {
    name: "Google",
    status: "degraded",
    latency: 450,
    errorRate: 5.1,
  },
  {
    name: "Mistral",
    status: "down",
    latency: 0,
    errorRate: 100,
  },
];

export async function GET() {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 500));
  
  return NextResponse.json({ data: mockHealthData });
}