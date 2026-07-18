import readline from "readline";
import { TelegramClient } from "teleproto";
import { StoreSession } from "teleproto/sessions";
import { NewMessage, NewMessageEvent } from "teleproto/events";
import { BehaviorSubject, Subject } from "rxjs";
import { distinctUntilChanged, shareReplay } from "rxjs/operators";
import { CONFIG } from "../config";
import { log } from "../utils/logger";
import {
  parseAveScannerSignal,
  type AveScannerSignal,
} from "./ave_scanner_parser";
import {
  parseAveMonitorSignal,
  type AveMonitorSignal,
} from "./ave_monitor_parser";

/* -------------------------------------------------------------------------- */
/*                           Telegram Client Singleton                        */
/* -------------------------------------------------------------------------- */
let telegramClient: TelegramClient | undefined;

export function getTelegramClient(): TelegramClient {
  if (telegramClient) {
    return telegramClient;
  }
  telegramClient = new TelegramClient(
    new StoreSession(CONFIG.telegramSessionName),
    Number(CONFIG.telegramApiId),
    CONFIG.telegramApiHash!,
    {
      connectionRetries: CONFIG.tgConnectionRetries,
      autoReconnect: true,
      reconnectRetries: Infinity,
      retryDelay: CONFIG.tgRetryDelayMs,
    },
  );
  return telegramClient;
}
export function resetTelegramClient(): void {
  telegramClient = undefined;
}

/* -------------------------------------------------------------------------- */
/*                              Console Helpers                               */
/* -------------------------------------------------------------------------- */
function createReadline() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function ask(question: string): Promise<string> {
  const rl = createReadline();
  return new Promise((resolve, reject) => {
    let completed = false;
    const timeout = setTimeout(() => {
      if (completed) return;
      completed = true;
      rl.close();
      reject(
        new Error(
          `Input timed out after ${CONFIG.tgAuthTimeoutMs / 1000} seconds.`,
        ),
      );
    }, CONFIG.tgAuthTimeoutMs);
    rl.question(question, (answer) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      rl.close();
      resolve(answer.trim());
    });
  });
}

const connectionStateInput$ = new BehaviorSubject<boolean>(false);
export const tgConnected$ = connectionStateInput$.pipe(
  distinctUntilChanged(),
  shareReplay({
    bufferSize: 1,
    refCount: true,
  }),
);

export const telegramSignal$ = new Subject<AveScannerSignal>();
export const telegramAveMonitorSignal$ = new Subject<AveMonitorSignal>();

let telegramChannelId: number | undefined = CONFIG.telegramChannelId
  ? Number(CONFIG.telegramChannelId)
  : undefined;

let telegramEventHandler: ((event: NewMessageEvent) => void) | undefined;
let telegramEventBuilder: NewMessage | undefined;

let telegramChannel2Id: number | undefined;
let telegramEventHandler2: ((event: NewMessageEvent) => void) | undefined;
let telegramEventBuilder2: NewMessage | undefined;

/* -------------------------------------------------------------------------- */
/*                          Telegram Listener Start                           */
/* -------------------------------------------------------------------------- */

function reconstructWithUrls(rawMessage: string, entities: any[]): string {
  const textUrls = entities
    .filter((e: any) => e.className === "MessageEntityTextUrl")
    .map((e: any) => ({ offset: e.offset, length: e.length, url: e.url }))
    .sort((a: any, b: any) => b.offset - a.offset);

  let result = rawMessage;
  for (const tu of textUrls) {
    const before = result.slice(0, tu.offset + tu.length);
    const after = result.slice(tu.offset + tu.length);
    result = before + ` (${tu.url})` + after;
  }

  return result;
}

export async function startTelegramListener(): Promise<void> {
  if (!CONFIG.telegramApiId || !CONFIG.telegramApiHash || !CONFIG.telegramChannelUserName) {
    throw new Error("Missing Telegram configuration: telegramApiId, telegramApiHash and telegramChannelUserName are required.");
  }

  const client = getTelegramClient();

  try {
    log.info("telegram", "Connecting...");
    await client.start({
      phoneNumber: () => ask("Phone number: "),
      phoneCode: () => ask("Telegram code: "),

      onError(error) {
        log.error("telegram", String(error));
      },
    });
    client.session.save();
    connectionStateInput$.next(true);
    log.success("telegram", "Connected");

    telegramChannelId = CONFIG.telegramChannelId
      ? Number(CONFIG.telegramChannelId)
      : undefined;
    if (!telegramChannelId) {
      const entity = await client.getEntity(CONFIG.telegramChannelUserName);
      telegramChannelId = Number(entity.id);
    }
    log.info("telegram", `Listening to ${CONFIG.telegramChannelUserName} (${telegramChannelId})`);

    if (telegramEventHandler && telegramEventBuilder) {
      try {
        client.removeEventHandler(telegramEventHandler, telegramEventBuilder);
      } catch (err) {
        log.warn("telegram", "Failed to remove old event handler:", err);
      }
    }
    telegramEventHandler = (event) => {
      const msg = event.message;
      const rawMessage = (msg as any)?.message ?? "";
      const entities: any[] = (msg as any)?.entities ?? [];
      const text = reconstructWithUrls(rawMessage, entities);

      const signal = parseAveScannerSignal(text);
      if (!signal) return;
      log.dev("telegram", `Parsed signal: ${signal.Token} ${signal.CA?.slice(0, 8)}`);
      telegramSignal$.next(signal);
    };

    telegramEventBuilder = new NewMessage({
      incoming: true,
      chats: [telegramChannelId],
    });
    client.addEventHandler(telegramEventHandler, telegramEventBuilder);
    log.info("telegram", "Listener started");

    // Second channel (Ave Signal Monitor)
    if (CONFIG.telegramChannel2UserName) {
      const entity2 = await client.getEntity(CONFIG.telegramChannel2UserName);
      telegramChannel2Id = Number(entity2.id);
      log.info("telegram", `Listening to ${CONFIG.telegramChannel2UserName} (${telegramChannel2Id})`);

      telegramEventHandler2 = (event) => {
        const msg = event.message;
        const rawMessage = (msg as any)?.message ?? "";
        const entities: any[] = (msg as any)?.entities ?? [];
        const text = reconstructWithUrls(rawMessage, entities);

        const signal = parseAveMonitorSignal(text);
        if (!signal) {
          return;
        }
        log.dev("telegram", `AVM Parsed: ${signal.token} ${signal.ca?.slice(0, 8)}`);
        telegramAveMonitorSignal$.next(signal);
      };

      telegramEventBuilder2 = new NewMessage({
        incoming: true,
        chats: [telegramChannel2Id],
      });
      client.addEventHandler(telegramEventHandler2, telegramEventBuilder2);
      log.info("telegram", "AVM Listener started");
    }
  } catch (error) {
    connectionStateInput$.next(false);
    log.error("telegram", "Failed to start listener:", error);
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/*                           Telegram Listener Stop                           */
/* -------------------------------------------------------------------------- */

export async function stopTelegramListener(): Promise<void> {
  const client = getTelegramClient();
  try {
    if (telegramEventHandler && telegramEventBuilder) {
      try {
        client.removeEventHandler(telegramEventHandler, telegramEventBuilder);
      } catch (err) {
        log.warn("telegram", "Failed to remove event handler on stop:", err);
      }
    }
    if (telegramEventHandler2 && telegramEventBuilder2) {
      try {
        client.removeEventHandler(telegramEventHandler2, telegramEventBuilder2);
      } catch (err) {
        log.warn("telegram", "AVM Failed to remove event handler on stop:", err);
      }
    }
    telegramEventHandler = undefined;
    telegramEventBuilder = undefined;
    telegramEventHandler2 = undefined;
    telegramEventBuilder2 = undefined;
    await client.disconnect();
    log.warn("telegram", "Disconnected");
  } finally {
    connectionStateInput$.next(false);
  }
}

export async function shutdownTelegram(): Promise<void> {
  try {
    await stopTelegramListener();
  } finally {
    connectionStateInput$.next(false);
    telegramChannelId = undefined;
    telegramChannel2Id = undefined;
    telegramEventHandler = undefined;
    telegramEventBuilder = undefined;
    telegramEventHandler2 = undefined;
    telegramEventBuilder2 = undefined;
    resetTelegramClient();
  }
}
