export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = JsonValue[];
export type JsonObject = { [Key in string]?: JsonValue };
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

export type SerializedError = {
  name: string;
  message: string;
  stack?: string;
}

export type Context = JsonObject;

