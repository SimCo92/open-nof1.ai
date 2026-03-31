import { run } from "@/lib/ai/run";
import { NextRequest } from "next/server";
import jwt from "jsonwebtoken";

export const GET = async (request: NextRequest) => {
  // Extract token from query parameters
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response("Token is required", { status: 400 });
  }

  try {
    jwt.verify(token, process.env.CRON_SECRET_KEY || "");
  } catch (error) {
    return new Response("Invalid token", { status: 401 });
  }

  try {
    await run(Number(process.env.START_MONEY));
    return new Response("Process executed successfully");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("3-minute run interval failed:", message);
    return new Response(`Process failed: ${message}`, { status: 500 });
  }
};
