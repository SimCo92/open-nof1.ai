import { NextRequest } from "next/server";
import jwt from "jsonwebtoken";
import { getAccountInformationAndPerformance } from "@/lib/trading/account-information-and-performance";
import { prisma } from "@/lib/prisma";
import { ModelType } from "@prisma/client";
import { InputJsonValue, JsonValue } from "@prisma/client/runtime/library";
import { uniformSample } from "@/lib/utils/sampling";

// maximum number of metrics to keep
const MAX_METRICS_COUNT = 100;

export const GET = async (request: NextRequest) => {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response("Token is required", { status: 400 });
  }

  try {
    jwt.verify(token, process.env.CRON_SECRET_KEY || "");
  } catch {
    return new Response("Invalid token", { status: 401 });
  }

  try {
    const accountInformationAndPerformance =
      await getAccountInformationAndPerformance(Number(process.env.START_MONEY));

    let existMetrics = await prisma.metrics.findFirst({
      where: {
        model: ModelType.Deepseek,
      },
    });

    if (!existMetrics) {
      existMetrics = await prisma.metrics.create({
        data: {
          name: "20-seconds-metrics",
          metrics: [],
          model: ModelType.Deepseek,
        },
      });
    }

    // add new metrics
    const newMetrics = [
      ...((existMetrics?.metrics || []) as JsonValue[]),
      {
        accountInformationAndPerformance,
        createdAt: new Date().toISOString(),
      },
    ] as JsonValue[];

    // if the metrics count exceeds the maximum limit, uniformly sample the metrics
    let finalMetrics = newMetrics;
    if (newMetrics.length > MAX_METRICS_COUNT) {
      finalMetrics = uniformSample(newMetrics, MAX_METRICS_COUNT);
    }

    await prisma.metrics.update({
      where: {
        id: existMetrics?.id,
      },
      data: {
        metrics: finalMetrics as InputJsonValue[],
      },
    });

    return new Response(
      `Process executed successfully. Metrics count: ${finalMetrics.length}`
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("20-second metrics interval failed:", message);
    return new Response(`Process failed: ${message}`, { status: 500 });
  }
};
