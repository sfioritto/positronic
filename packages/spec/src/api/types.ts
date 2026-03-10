export type Fetch = (request: Request) => Promise<Response>;
export type FetchFactory = (userName: string) => Promise<{ fetch: Fetch; userName: string }>;
