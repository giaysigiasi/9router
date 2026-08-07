import { NextResponse } from "next/server";

// Mock data - in a real app, this would be the current token saver config
const mockTokenConfig = {
  "default": {
    "mode": "truncate",
    "max_tokens": 2048
  },
  "anthropic/claude-3-opus-20240229": {
    "mode": "truncate",
    "max_tokens": 4096
  },
  "openai/gpt-4-turbo": {
    "mode": "off"
  }
};

export async function GET() {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 200));
  
  return NextResponse.json({ data: mockTokenConfig });
}