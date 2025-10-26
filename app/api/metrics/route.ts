import { prisma } from "@/lib/prisma";
import { ModelType } from "@prisma/client";
import { NextResponse } from "next/server";
import { MetricData } from "@/lib/types/metrics";

// Maximum number of data points to return
const MAX_DATA_POINTS = 50;

/**
 * Evenly sample a fixed number of items from an array.
 * @param data - Source dataset
 * @param sampleSize - Number of elements to sample
 * @returns Evenly spaced sampled data
 */
function uniformSample<T>(data: T[], sampleSize: number): T[] {
  if (data.length <= sampleSize) {
    return data;
  }

  const result: T[] = [];
  const step = (data.length - 1) / (sampleSize - 1);

  for (let i = 0; i < sampleSize; i++) {
    const index = Math.round(i * step);
    result.push(data[index]);
  }

  return result;
}

export const GET = async () => {
  try {
    const metrics = await prisma.metrics.findFirst({
      where: {
        model: ModelType.Deepseek,
      },
    });

    if (!metrics) {
      return NextResponse.json({
        data: {
          metrics: [],
          totalCount: 0,
        },
        success: true,
      });
    }

    const databaseMetrics = metrics.metrics as unknown as {
      createdAt: string;
      accountInformationAndPerformance: MetricData[];
    }[];

    const metricsData = databaseMetrics
      .map((item) => {
        return {
          ...item.accountInformationAndPerformance,
          createdAt: item?.createdAt || new Date().toISOString(),
        };
      })
      .filter((item) => (item as unknown as MetricData).availableCash > 0);

    // Evenly sample the data, limiting to MAX_DATA_POINTS entries
    const sampledMetrics = uniformSample(metricsData, MAX_DATA_POINTS);

    console.log(
      `📊 Total metrics: ${metricsData.length}, Sampled: ${sampledMetrics.length}`
    );

    return NextResponse.json({
      data: {
        metrics: sampledMetrics,
        totalCount: metricsData.length,
        model: metrics?.model || ModelType.Deepseek,
        name: metrics?.name || "Deepseek Trading Bot",
        createdAt: metrics?.createdAt || new Date().toISOString(),
        updatedAt: metrics?.updatedAt || new Date().toISOString(),
      },
      success: true,
    });
  } catch (error) {
    console.error("Error fetching metrics:", error);
    return NextResponse.json({
      data: {
        metrics: [],
        totalCount: 0,
        model: ModelType.Deepseek,
        name: "Deepseek Trading Bot",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      success: true,
    });
  }
};
