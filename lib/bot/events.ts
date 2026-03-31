import { EventEmitter } from "events";
import type { BotEvents } from "./types";

export class TypedEventEmitter extends EventEmitter {
  emit<K extends keyof BotEvents>(event: K, payload: BotEvents[K]): boolean {
    return super.emit(event, payload);
  }
  on<K extends keyof BotEvents>(
    event: K,
    listener: (payload: BotEvents[K]) => void
  ): this {
    return super.on(event, listener);
  }
  once<K extends keyof BotEvents>(
    event: K,
    listener: (payload: BotEvents[K]) => void
  ): this {
    return super.once(event, listener);
  }
}
