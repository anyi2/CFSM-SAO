import { describe, expect, it } from "vitest";
import { ApiRequestError, MAX_API_RESPONSE_BYTES, readJsonResponse } from "@/services/cfsm/http";

describe("readJsonResponse", () => {
  it("parses a normal JSON response", async () => {
    const response = new Response(JSON.stringify({ success: true, count: 3 }), {
      headers: { "Content-Type": "application/json" },
    });
    await expect(readJsonResponse(response, "/api/config", 1024)).resolves.toEqual({
      success: true,
      count: 3,
    });
  });

  it("rejects a response whose declared content length exceeds the limit", async () => {
    const response = new Response("{}", {
      headers: { "Content-Length": "1024" },
    });
    await expect(readJsonResponse(response, "/api/servers", 100)).rejects.toMatchObject({
      status: 413,
      path: "/api/servers",
    } satisfies Partial<ApiRequestError>);
  });

  it("counts streamed bytes when content length is absent", async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"data":"'));
        controller.enqueue(new TextEncoder().encode("x".repeat(128)));
        controller.enqueue(new TextEncoder().encode('"}'));
        controller.close();
      },
    }));
    await expect(readJsonResponse(response, "/api/history", 64)).rejects.toMatchObject({
      status: 413,
      path: "/api/history",
    });
  });

  it("uses a finite 64 MiB default cap for CFSM responses", () => {
    expect(MAX_API_RESPONSE_BYTES).toBe(64 * 1024 * 1024);
  });
});
