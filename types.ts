import { z } from 'zod';

export type ResponseModel<T extends z.AnyZodObject> = {
    schema: T;
    name: string;
    description?: string;
}

export interface PromptClient {
  execute<T extends z.AnyZodObject>(
    prompt: string,
    responseModel: ResponseModel<T>,
  ): Promise<z.infer<T>>;
}

export type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never;
