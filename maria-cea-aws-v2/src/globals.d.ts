// Node.js 20+ global types not included in ES2022 lib
declare const fetch: typeof globalThis.fetch;
declare const AbortSignal: typeof globalThis.AbortSignal;
declare const FormData: typeof globalThis.FormData;
declare const Response: typeof globalThis.Response;
declare const Request: typeof globalThis.Request;
declare const Headers: typeof globalThis.Headers;
declare type RequestInit = globalThis.RequestInit;
declare type Response = globalThis.Response;
