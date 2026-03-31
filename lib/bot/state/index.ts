import { prisma } from "@/lib/prisma";
import { BotStatus as PrismaBotStatus } from "@prisma/client";
import type { BotConfig, BotState, BotStatus } from "../types";
import { Logger } from "../logger";
import { Heartbeat } from "./heartbeat";

// Map between our BotStatus and Prisma's BotStatus enum
const statusToPrisma: Record<BotStatus, PrismaBotStatus> = {
  idle: PrismaBotStatus.Idle,
  running: PrismaBotStatus.Running,
  paused: PrismaBotStatus.Paused,
  stopped: PrismaBotStatus.Stopped,
  error: PrismaBotStatus.Error,
};

const prismaToStatus: Record<PrismaBotStatus, BotStatus> = {
  [PrismaBotStatus.Idle]: "idle",
  [PrismaBotStatus.Running]: "running",
  [PrismaBotStatus.Paused]: "paused",
  [PrismaBotStatus.Stopped]: "stopped",
  [PrismaBotStatus.Error]: "error",
};

export class BotStateManager {
  private log: Logger;
  private heartbeat: Heartbeat;
  private botId: string;

  constructor(config: BotConfig, log: Logger) {
    this.botId = config.botId;
    this.log = log.child("state");
    this.heartbeat = new Heartbeat(config.tickIntervalMs, log);
  }

  async initialize(config: BotConfig): Promise<BotState> {
    // Upsert the bot instance
    const instance = await prisma.botInstance.upsert({
      where: { botId: this.botId },
      create: {
        botId: this.botId,
        config: config as any,
        status: PrismaBotStatus.Idle,
      },
      update: {}, // Don't overwrite existing state on restart
    });

    return this.toState(instance);
  }

  async loadState(): Promise<BotState | null> {
    const instance = await prisma.botInstance.findUnique({
      where: { botId: this.botId },
    });
    if (!instance) return null;
    return this.toState(instance);
  }

  async updateStatus(status: BotStatus, error?: string): Promise<void> {
    await prisma.botInstance.update({
      where: { botId: this.botId },
      data: {
        status: statusToPrisma[status],
        lastError: error || null,
        ...(status === "running" ? { startedAt: new Date() } : {}),
        ...(status === "stopped" ? { stoppedAt: new Date() } : {}),
      },
    });
    this.log.info(`Bot status: ${status}`, error ? { error } : {});
  }

  async recordTick(): Promise<void> {
    this.heartbeat.tick();
    await prisma.botInstance.update({
      where: { botId: this.botId },
      data: {
        lastTickAt: new Date(),
        tickCount: { increment: 1 },
      },
    });
  }

  async persistCircuitBreakerState(state: {
    consecutiveLosses: number;
    dailyPnl: number;
    brokenUntil: Date | null;
    dailyPnlResetAt: Date;
  }): Promise<void> {
    await prisma.botInstance.update({
      where: { botId: this.botId },
      data: {
        consecutiveLosses: state.consecutiveLosses,
        dailyPnl: state.dailyPnl,
        circuitBrokenUntil: state.brokenUntil,
        dailyPnlResetAt: state.dailyPnlResetAt,
      },
    });
  }

  wasRunning(state: BotState): boolean {
    return state.status === "running" && this.heartbeat.isStale();
  }

  getBotId(): string {
    return this.botId;
  }

  getHeartbeat(): Heartbeat {
    return this.heartbeat;
  }

  private toState(instance: any): BotState {
    return {
      botId: instance.botId,
      status:
        prismaToStatus[instance.status as PrismaBotStatus] || "idle",
      startedAt: instance.startedAt,
      lastTickAt: instance.lastTickAt,
      lastError: instance.lastError,
      consecutiveLosses: instance.consecutiveLosses,
      dailyPnl: instance.dailyPnl,
      dailyPnlResetAt: instance.dailyPnlResetAt,
      circuitBrokenUntil: instance.circuitBrokenUntil,
      tickCount: instance.tickCount,
    };
  }
}
