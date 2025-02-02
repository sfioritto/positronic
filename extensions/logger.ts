import type { Extension, Workflow } from "../dsl/new-dsl";
import { JsonObject } from "../dsl/types";

export interface LoggerContext extends JsonObject {
  logs: string[];
}

export type LoggerExtension<T extends Record<string, any>> = {
  log: (message: string) => Workflow<LoggerContext, JsonObject, JsonObject, T>;
}

export const loggerExtension: Extension<{}, LoggerExtension<any>> = (builder) => ({
  log: (message: string) =>
    builder.step(
      `Log: ${message}`,
      () => ({ logs: [message] })
    ) as unknown as Workflow<LoggerContext, JsonObject, JsonObject, LoggerExtension<any>>
});
