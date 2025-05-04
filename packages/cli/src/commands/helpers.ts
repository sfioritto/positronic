import fetch, { type RequestInit, type Response } from 'node-fetch';
import process from 'process';

// API Fetch Helper
export async function apiFetch(apiPath: string, options?: RequestInit): Promise<Response> {
    const port = process.env.POSITRONIC_SERVER_PORT || '8787';
    const baseUrl = `http://localhost:${port}`;
    const fullUrl = `${baseUrl}${apiPath.startsWith('/') ? apiPath : '/' + apiPath}`;

    const response = await fetch(fullUrl, options);
    return response;
}