import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { GET as pingHandler } from "@/app/api/v1/ping/route";
import {
    SUPPORTED_API_VERSIONS,
    SUPPORTED_VERSIONS_HEADER_NAME,
    SUPPORTED_VERSIONS_HEADER_VALUE,
    isSupportedApiVersion,
    parseApiVersionFromPath,
} from "@/lib/publicApi/versions";
import {
    generateRequestId,
    isValidRequestId,
    resolveRequestId,
    REQUEST_ID_HEADER_NAME,
} from "@/lib/publicApi/requestId";
import {
    PUBLIC_ERROR_CODES,
    PUBLIC_ERROR_STATUS_MAP,
    getErrorDocumentationUrl,
    PublicApiError,
} from "@/lib/publicApi/errors";
import {
    successEnvelope,
    errorEnvelope,
    jsonSuccess,
    jsonError,
} from "@/lib/publicApi/envelope";
import { handleApiVersionDispatch } from "@/lib/publicApi/dispatch";
import { withPublicApiContext } from "@/lib/publicApi/handler";
import { middleware, proxy } from "@/proxy";

describe("Phase 1.18.2 / 1.18.3 — Public API Versioning Foundation & Envelopes", () => {
    describe("1. Version Constants & Strict Path Parsing", () => {
        it("should define v1 as the only supported version in this phase", () => {
            expect(SUPPORTED_API_VERSIONS).toEqual(["v1"]);
            expect(isSupportedApiVersion("v1")).toBe(true);
            expect(isSupportedApiVersion("v0")).toBe(false);
            expect(isSupportedApiVersion("v2")).toBe(false);
            expect(isSupportedApiVersion("v1.1")).toBe(false);
        });

        it("should parse strictly formatted versioned public paths (/api/v<digits>/...)", () => {
            expect(parseApiVersionFromPath("/api/v1/work-orders")).toEqual({
                isPublicApi: true,
                version: "v1",
                isSupported: true,
                subPath: "/work-orders",
            });

            expect(parseApiVersionFromPath("/api/v2/customers")).toEqual({
                isPublicApi: true,
                version: "v2",
                isSupported: false,
                subPath: "/customers",
            });

            expect(parseApiVersionFromPath("/api/v0/ping")).toEqual({
                isPublicApi: true,
                version: "v0",
                isSupported: false,
                subPath: "/ping",
            });

            expect(parseApiVersionFromPath("/api/v10/assets")).toEqual({
                isPublicApi: true,
                version: "v10",
                isSupported: false,
                subPath: "/assets",
            });
        });

        it("should NOT treat internal routes starting with 'v' as public API versions (Regression Guard)", () => {
            // Internal routes starting with "v" must NOT be shadowed or parsed as public versions
            expect(parseApiVersionFromPath("/api/vendors")).toEqual({
                isPublicApi: false,
                isSupported: false,
            });

            expect(parseApiVersionFromPath("/api/verify-email")).toEqual({
                isPublicApi: false,
                isSupported: false,
            });

            expect(parseApiVersionFromPath("/api/vouchers/redeem")).toEqual({
                isPublicApi: false,
                isSupported: false,
            });

            expect(parseApiVersionFromPath("/api/vehicles/track")).toEqual({
                isPublicApi: false,
                isSupported: false,
            });

            expect(parseApiVersionFromPath("/api/visitors/log")).toEqual({
                isPublicApi: false,
                isSupported: false,
            });

            expect(parseApiVersionFromPath("/api/versioning")).toEqual({
                isPublicApi: false,
                isSupported: false,
            });

            expect(parseApiVersionFromPath("/api/work-orders")).toEqual({
                isPublicApi: false,
                isSupported: false,
            });

            expect(parseApiVersionFromPath("/api/auth/session")).toEqual({
                isPublicApi: false,
                isSupported: false,
            });
        });
    });

    describe("2. Request ID Generation & Validation (Edge & Web Crypto Safe)", () => {
        it("should generate valid request IDs starting with req_ using Web Crypto API", () => {
            const reqId = generateRequestId();
            expect(reqId.startsWith("req_")).toBe(true);
            expect(isValidRequestId(reqId)).toBe(true);
            expect(reqId.length).toBeGreaterThanOrEqual(20);
        });

        it("should validate safe request IDs and reject malformed/malicious values", () => {
            // Valid cases
            expect(isValidRequestId("req_01HPX7K9V4Z8Y6M2E3W1N0QRST")).toBe(true);
            expect(isValidRequestId("custom-client-request-id-123")).toBe(true);
            expect(isValidRequestId("trace_abc_123")).toBe(true);

            // Invalid / Malicious cases
            expect(isValidRequestId("")).toBe(false);
            expect(isValidRequestId(null)).toBe(false);
            expect(isValidRequestId(undefined)).toBe(false);
            expect(isValidRequestId("req\nnewline")).toBe(false);
            expect(isValidRequestId("req\r\ninjection")).toBe(false);
            expect(isValidRequestId("req<script>alert(1)</script>")).toBe(false);
            expect(isValidRequestId('req" OR "1"="1')).toBe(false);
            expect(isValidRequestId("a".repeat(65))).toBe(false); // Exceeds 64 chars
        });

        it("should pass through valid X-Request-Id and regenerate invalid ones", () => {
            const valid = resolveRequestId("client-req-999");
            expect(valid.requestId).toBe("client-req-999");
            expect(valid.isGenerated).toBe(false);

            const malicious = resolveRequestId("invalid<script>");
            expect(malicious.isGenerated).toBe(true);
            expect(malicious.requestId.startsWith("req_")).toBe(true);
            expect(malicious.requestId).not.toContain("<script>");

            const missing = resolveRequestId(undefined);
            expect(missing.isGenerated).toBe(true);
            expect(missing.requestId.startsWith("req_")).toBe(true);
        });
    });

    describe("3. Edge Runtime Import Safety Audit", () => {
        it("should ensure proxy.ts and its direct import graph contain zero Node-only built-in modules", () => {
            const forbiddenNodeModules = [
                "node:crypto",
                "node:async_hooks",
                "node:fs",
                "node:path",
                "node:os",
                "node:net",
                "node:child_process",
                "node:http",
                "node:https",
                "'crypto'",
                '"crypto"',
                "'async_hooks'",
                '"async_hooks"',
                "'fs'",
                '"fs"',
            ];

            const filesToCheck = [
                path.resolve(process.cwd(), "proxy.ts"),
                path.resolve(process.cwd(), "lib/publicApi/versions.ts"),
                path.resolve(process.cwd(), "lib/publicApi/requestId.ts"),
                path.resolve(process.cwd(), "lib/publicApi/errors.ts"),
                path.resolve(process.cwd(), "lib/publicApi/envelope.ts"),
                path.resolve(process.cwd(), "lib/publicApi/dispatch.ts"),
            ];

            for (const filePath of filesToCheck) {
                const fileContent = fs.readFileSync(filePath, "utf-8");
                for (const forbidden of forbiddenNodeModules) {
                    const hasForbiddenImport =
                        fileContent.includes(`import `) && fileContent.includes(forbidden);
                    expect(
                        hasForbiddenImport,
                        `File ${path.basename(filePath)} should not contain Node-only module import: ${forbidden}`,
                    ).toBe(false);
                }
            }
        });
    });

    describe("4. Canonical Response Envelope Helpers", () => {
        it("should construct canonical successEnvelope shape per Architecture Section 5", () => {
            const data = { id: "wo_123", status: "IN_PROGRESS" };
            const envelope = successEnvelope(data, {
                requestId: "req_test_123",
                timestamp: "2026-08-29T12:00:00.000Z",
                meta: {
                    pagination: {
                        hasMore: true,
                        limit: 25,
                        nextCursor: "cur_next",
                        prevCursor: null,
                    },
                },
            });

            expect(envelope).toEqual({
                success: true,
                data: { id: "wo_123", status: "IN_PROGRESS" },
                meta: {
                    requestId: "req_test_123",
                    timestamp: "2026-08-29T12:00:00.000Z",
                    pagination: {
                        hasMore: true,
                        limit: 25,
                        nextCursor: "cur_next",
                        prevCursor: null,
                    },
                },
            });
        });

        it("should construct canonical errorEnvelope shape per Architecture Section 5 & 7", () => {
            const envelope = errorEnvelope(
                PUBLIC_ERROR_CODES.VALIDATION_ERROR,
                "The request body failed validation constraints.",
                {
                    requestId: "req_err_123",
                    details: [
                        {
                            field: "priority",
                            issue: "INVALID_ENUM_VALUE",
                            message: "priority must be one of: LOW, MEDIUM, HIGH.",
                        },
                    ],
                },
            );

            expect(envelope).toEqual({
                success: false,
                error: {
                    code: "VALIDATION_ERROR",
                    message: "The request body failed validation constraints.",
                    details: [
                        {
                            field: "priority",
                            issue: "INVALID_ENUM_VALUE",
                            message: "priority must be one of: LOW, MEDIUM, HIGH.",
                        },
                    ],
                    requestId: "req_err_123",
                    documentationUrl: "https://docs.aforden.com/api/errors#VALIDATION_ERROR",
                },
            });
        });

        it("should return correct HTTP status codes in jsonSuccess and jsonError", async () => {
            const successRes = jsonSuccess({ hello: "world" }, { status: 201 });
            expect(successRes.status).toBe(201);
            expect(successRes.headers.get("content-type")).toBe("application/json");
            expect(successRes.headers.has("x-request-id")).toBe(true);

            const errRes = jsonError("UNAUTHORIZED", "Missing API key");
            expect(errRes.status).toBe(401);
            const errJson = await errRes.json();
            expect(errJson.success).toBe(false);
            expect(errJson.error.code).toBe("UNAUTHORIZED");
        });
    });

    describe("5. Error Taxonomy Verification", () => {
        it("should define all 9 canonical error codes with fixed status codes", () => {
            expect(Object.keys(PUBLIC_ERROR_CODES)).toHaveLength(9);
            expect(PUBLIC_ERROR_STATUS_MAP.UNAUTHORIZED).toBe(401);
            expect(PUBLIC_ERROR_STATUS_MAP.FORBIDDEN).toBe(403);
            expect(PUBLIC_ERROR_STATUS_MAP.VALIDATION_ERROR).toBe(422);
            expect(PUBLIC_ERROR_STATUS_MAP.NOT_FOUND).toBe(404);
            expect(PUBLIC_ERROR_STATUS_MAP.CONFLICT).toBe(409);
            expect(PUBLIC_ERROR_STATUS_MAP.RATE_LIMITED).toBe(429);
            expect(PUBLIC_ERROR_STATUS_MAP.IDEMPOTENCY_CONFLICT).toBe(409);
            expect(PUBLIC_ERROR_STATUS_MAP.API_VERSION_UNSUPPORTED).toBe(404);
            expect(PUBLIC_ERROR_STATUS_MAP.INTERNAL_SERVER_ERROR).toBe(500);
        });

        it("should generate correct documentation URLs", () => {
            expect(getErrorDocumentationUrl("API_VERSION_UNSUPPORTED")).toBe(
                "https://docs.aforden.com/api/errors#API_VERSION_UNSUPPORTED",
            );
        });
    });

    describe("6. Baseline Route Context & Request ID Tracing", () => {
        const sampleOpenHandler = withPublicApiContext(async () => {
            return jsonSuccess({
                status: "ok",
                message: "Aforden Public API v1 is operational",
            });
        });

        it("should return HTTP 200 with standard success envelope and generated requestId", async () => {
            const req = new Request("http://localhost:3000/api/v1/sample", {
                method: "GET",
            });

            const res = await sampleOpenHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual({
                status: "ok",
                message: "Aforden Public API v1 is operational",
            });
            expect(json.meta).toBeDefined();
            expect(json.meta.requestId.startsWith("req_")).toBe(true);
            expect(json.meta.timestamp).toBeDefined();

            expect(res.headers.get("x-request-id")).toBe(json.meta.requestId);
            expect(res.headers.get("content-type")).toBe("application/json");
        });

        it("should preserve valid incoming X-Request-Id header on response", async () => {
            const req = new Request("http://localhost:3000/api/v1/sample", {
                method: "GET",
                headers: {
                    "x-request-id": "client-trace-id-abc-123",
                },
            });

            const res = await sampleOpenHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.meta.requestId).toBe("client-trace-id-abc-123");
            expect(res.headers.get("x-request-id")).toBe("client-trace-id-abc-123");
        });

        it("should sanitize malformed incoming X-Request-Id header", async () => {
            const req = new Request("http://localhost:3000/api/v1/sample", {
                method: "GET",
                headers: {
                    "x-request-id": "evil<script>alert(1)</script>",
                },
            });

            const res = await sampleOpenHandler(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.meta.requestId.startsWith("req_")).toBe(true);
            expect(json.meta.requestId).not.toContain("<script>");
            expect(res.headers.get("x-request-id")).toBe(json.meta.requestId);
        });
    });

    describe("7. Version Dispatcher & Unsupported Version Handling", () => {
        it("should return HTTP 404 with API_VERSION_UNSUPPORTED for /api/v0/anything", async () => {
            const req = new Request("http://localhost:3000/api/v0/work-orders", {
                method: "GET",
            });

            const res = handleApiVersionDispatch(req);
            expect(res).not.toBeNull();
            expect(res!.status).toBe(404);
            expect(res!.headers.get(SUPPORTED_VERSIONS_HEADER_NAME)).toBe("v1");
            expect(res!.headers.has("x-request-id")).toBe(true);

            const json = await res!.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("API_VERSION_UNSUPPORTED");
            expect(json.error.message).toContain("version 'v0' is not supported");
            expect(json.error.documentationUrl).toBe(
                "https://docs.aforden.com/api/errors#API_VERSION_UNSUPPORTED",
            );
        });

        it("should return HTTP 404 with API_VERSION_UNSUPPORTED for /api/v2/customers", async () => {
            const req = new Request("http://localhost:3000/api/v2/customers", {
                method: "GET",
                headers: {
                    "x-request-id": "v2-test-req-id",
                },
            });

            const res = handleApiVersionDispatch(req);
            expect(res).not.toBeNull();
            expect(res!.status).toBe(404);
            expect(res!.headers.get(SUPPORTED_VERSIONS_HEADER_NAME)).toBe("v1");
            expect(res!.headers.get("x-request-id")).toBe("v2-test-req-id");

            const json = await res!.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("API_VERSION_UNSUPPORTED");
            expect(json.error.requestId).toBe("v2-test-req-id");
        });

        it("should return null (allow pass-through) for supported version /api/v1/...", () => {
            const req = new Request("http://localhost:3000/api/v1/work-orders", {
                method: "GET",
            });

            const res = handleApiVersionDispatch(req);
            expect(res).toBeNull();
        });

        it("should return null (allow pass-through) for internal routes including those starting with 'v'", () => {
            expect(
                handleApiVersionDispatch(
                    new Request("http://localhost:3000/api/work-orders", { method: "GET" }),
                ),
            ).toBeNull();

            expect(
                handleApiVersionDispatch(
                    new Request("http://localhost:3000/api/vendors", { method: "GET" }),
                ),
            ).toBeNull();

            expect(
                handleApiVersionDispatch(
                    new Request("http://localhost:3000/api/verify-email", { method: "GET" }),
                ),
            ).toBeNull();

            expect(
                handleApiVersionDispatch(
                    new Request("http://localhost:3000/api/vouchers", { method: "GET" }),
                ),
            ).toBeNull();
        });
    });

    describe("8. Next.js Middleware Integration & Boundary Isolation", () => {
        it("should intercept unsupported API versions in middleware and return 404", async () => {
            const req = new NextRequest("http://localhost:3000/api/v2/invoices");
            const res = middleware(req);

            expect(res.status).toBe(404);
            expect(res.headers.get("x-aforden-supported-versions")).toBe("v1");
            const json = await res.json();
            expect(json.error.code).toBe("API_VERSION_UNSUPPORTED");
        });

        it("should pass supported version (/api/v1/...) through with forwarded x-request-id", () => {
            const req = new NextRequest("http://localhost:3000/api/v1/ping", {
                headers: {
                    "x-request-id": "client-forward-trace",
                },
            });
            const res = middleware(req);

            expect(res.status).toBe(200); // NextResponse.next()
            expect(res.headers.get("x-request-id")).toBe("client-forward-trace");
        });

        it("should pass internal routes starting with 'v' untouched through middleware (not shadowed by /api/v*)", () => {
            const vendorReq = new NextRequest("http://localhost:3000/api/vendors");
            const vendorRes = middleware(vendorReq);
            expect(vendorRes.status).toBe(200); // Pass-through to internal handler

            const verifyReq = new NextRequest("http://localhost:3000/api/verify-email");
            const verifyRes = middleware(verifyReq);
            expect(verifyRes.status).toBe(200); // Pass-through to internal handler

            const voucherReq = new NextRequest("http://localhost:3000/api/vouchers/redeem");
            const voucherRes = middleware(voucherReq);
            expect(voucherRes.status).toBe(200); // Pass-through to internal handler
        });

        it("should ignore non-versioned standard internal routes (/api/work-orders)", () => {
            const req = new NextRequest("http://localhost:3000/api/work-orders");
            const res = middleware(req);
            expect(res.status).toBe(200); // NextResponse.next()
        });
    });

    describe("9. Handler Error Sanitization", () => {
        it("should sanitize unhandled internal errors into 500 INTERNAL_SERVER_ERROR", async () => {
            const buggyHandler = withPublicApiContext(async () => {
                throw new Error("DB Connection Failed: secret_password_123");
            });

            const req = new Request("http://localhost:3000/api/v1/buggy", {
                method: "GET",
                headers: {
                    "x-request-id": "err-trace-1",
                },
            });

            const res = await buggyHandler(req);
            expect(res.status).toBe(500);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("INTERNAL_SERVER_ERROR");
            expect(json.error.requestId).toBe("err-trace-1");
            expect(json.error.message).not.toContain("secret_password_123");
            expect(json.error.message).toBe(
                "An unexpected error occurred processing your request.",
            );
        });

        it("should serialize PublicApiError directly with its designated code and status", async () => {
            const customHandler = withPublicApiContext(async () => {
                throw new PublicApiError("FORBIDDEN", "API key missing required scope.", {
                    details: [{ issue: "MISSING_SCOPE", message: "Requires work_orders:read" }],
                });
            });

            const req = new Request("http://localhost:3000/api/v1/protected", {
                method: "GET",
            });

            const res = await customHandler(req);
            expect(res.status).toBe(403);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("FORBIDDEN");
            expect(json.error.message).toBe("API key missing required scope.");
            expect(json.error.details).toEqual([
                { issue: "MISSING_SCOPE", message: "Requires work_orders:read" },
            ]);
        });
    });
});
