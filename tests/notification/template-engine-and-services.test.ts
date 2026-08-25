import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    renderTemplate,
    escapeHtml,
    extractTemplateTokens,
    validateTemplateTokens,
    getSystemDefaultTemplate,
    resolveNotificationTemplate,
    renderNotificationContent,
    createNotificationTemplate,
    updateNotificationTemplate,
    listNotificationTemplates,
    deactivateNotificationTemplate,
    NotificationEventType,
    NotificationChannel,
    MembershipRole,
    NotificationTemplateCompilationError,
    NotificationTemplateNotFoundError,
    NotificationActorUnauthorizedError,
} from "@/lib/services/notification";

describe("Phase 1.13.5 — Template Engine & Safe Token Interpolation", () => {
    let mockPrisma: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockPrisma = {
            workspaceMember: {
                findFirst: vi.fn(),
            },
            notificationTemplate: {
                findFirst: vi.fn(),
                findMany: vi.fn(),
                create: vi.fn(),
                update: vi.fn(),
                upsert: vi.fn(),
            },
        };
    });

    describe("1. Safe Token Interpolation Engine (renderTemplate & escapeHtml)", () => {
        const whitelist = [
            "workOrderNumber",
            "title",
            "customerName",
            "technicianName",
            "amount",
        ];

        it("escapes all HTML special characters correctly", () => {
            const raw = `<b>"Dangerous" & 'Malicious' <script>alert(1)</script></b>`;
            const safe = escapeHtml(raw);
            expect(safe).toBe(
                "&lt;b&gt;&quot;Dangerous&quot; &amp; &#39;Malicious&#39; &lt;script&gt;alert(1)&lt;/script&gt;&lt;/b&gt;",
            );
        });

        it("extracts template tokens correctly", () => {
            const template =
                "Hello {{ customerName }}, work order {{workOrderNumber}} is ready.";
            const tokens = extractTemplateTokens(template);
            expect(tokens).toEqual(["customerName", "workOrderNumber"]);
        });

        it("replaces whitelisted tokens with escaped values", () => {
            const template =
                "Work Order {{workOrderNumber}} ({{title}}) for {{customerName}} has been assigned to {{technicianName}}.";
            const variables = {
                workOrderNumber: "WO-101",
                title: "HVAC <Repair> & Check",
                customerName: "Acme & Co",
                technicianName: "Bob 'The Tech'",
            };

            const rendered = renderTemplate(template, variables, whitelist);
            expect(rendered).toBe(
                "Work Order WO-101 (HVAC &lt;Repair&gt; &amp; Check) for Acme &amp; Co has been assigned to Bob &#39;The Tech&#39;.",
            );
        });

        it("renders missing or null variables as empty string without error", () => {
            const template = "Work Order {{workOrderNumber}} for {{customerName}}.";
            const variables = {
                workOrderNumber: "WO-101",
                customerName: null,
            };

            const rendered = renderTemplate(template, variables, whitelist);
            expect(rendered).toBe("Work Order WO-101 for .");
        });

        it("throws NotificationTemplateCompilationError when encountering a non-whitelisted token", () => {
            const illegalTemplate =
                "Work Order {{workOrderNumber}} created by {{unknownUserRole}}.";
            const variables = {
                workOrderNumber: "WO-101",
                unknownUserRole: "SuperAdmin",
            };

            expect(() =>
                renderTemplate(illegalTemplate, variables, whitelist),
            ).toThrow(NotificationTemplateCompilationError);
        });

        it("validateTemplateTokens throws at validation time for illegal tokens", () => {
            const illegalTemplate = "Amount: {{amount}} with secret {{internalCost}}";
            expect(() =>
                validateTemplateTokens(illegalTemplate, whitelist),
            ).toThrow(NotificationTemplateCompilationError);
        });
    });

    describe("2. System Default Templates Registry", () => {
        it("returns a production-ready default template for WORK_ORDER_CREATED on EMAIL", () => {
            const template = getSystemDefaultTemplate(
                NotificationEventType.WORK_ORDER_CREATED,
                NotificationChannel.EMAIL,
            );

            expect(template.isCustom).toBe(false);
            expect(template.subject).toContain("{{workOrderNumber}}");
            expect(template.bodyText).toContain("{{workOrderNumber}}");
            expect(template.bodyHtml).toContain("<strong>{{workOrderNumber}}</strong>");
        });

        it("returns a default template for IN_APP without subject", () => {
            const template = getSystemDefaultTemplate(
                NotificationEventType.INVOICE_OVERDUE,
                NotificationChannel.IN_APP,
            );

            expect(template.subject).toBeNull();
            expect(template.bodyText).toContain("{{invoiceNumber}}");
        });

        it("throws NotificationTemplateNotFoundError when no default exists for channel", () => {
            expect(() =>
                getSystemDefaultTemplate(
                    NotificationEventType.QUOTE_CREATED,
                    NotificationChannel.SMS, // SMS is not in defaultChannels for QUOTE_CREATED
                ),
            ).toThrow(NotificationTemplateNotFoundError);
        });
    });

    describe("3. Template Resolution Precedence (resolveNotificationTemplate)", () => {
        it("prefers active custom workspace template over system default", async () => {
            mockPrisma.notificationTemplate.findFirst.mockResolvedValue({
                id: "tmpl_custom_1",
                workspaceId: "ws_A",
                eventType: NotificationEventType.WORK_ORDER_ASSIGNED,
                channel: NotificationChannel.EMAIL,
                locale: "en",
                subject: "Custom Assignment Subject: {{workOrderNumber}}",
                bodyHtml: "<p>Custom Assignment HTML {{workOrderNumber}}</p>",
                bodyText: "Custom Assignment Text {{workOrderNumber}}",
                isActive: true,
            });

            const template = await resolveNotificationTemplate(
                mockPrisma,
                "ws_A",
                NotificationEventType.WORK_ORDER_ASSIGNED,
                NotificationChannel.EMAIL,
            );

            expect(template.isCustom).toBe(true);
            expect(template.id).toBe("tmpl_custom_1");
            expect(template.subject).toBe(
                "Custom Assignment Subject: {{workOrderNumber}}",
            );
        });

        it("falls back to system default when no custom template exists in database", async () => {
            mockPrisma.notificationTemplate.findFirst.mockResolvedValue(null);

            const template = await resolveNotificationTemplate(
                mockPrisma,
                "ws_A",
                NotificationEventType.WORK_ORDER_ASSIGNED,
                NotificationChannel.EMAIL,
            );

            expect(template.isCustom).toBe(false);
            expect(template.subject).toBe(
                "Assignment: Work Order {{workOrderNumber}} - {{title}}",
            );
        });
    });

    describe("4. End-to-End Render Pipeline (renderNotificationContent)", () => {
        it("renders full notification content (subject, body, bodyHtml) with sanitized variables", async () => {
            mockPrisma.notificationTemplate.findFirst.mockResolvedValue(null); // system default

            const payload = {
                workOrderId: "wo_101",
                workOrderNumber: "WO-101",
                title: "Emergency Pipe Leak",
                customerId: "cust_1",
                customerName: "Acme Towers",
                technicianId: "tech_1",
                technicianName: "Alice & Bob",
                priority: "HIGH",
                // Extra unwhitelisted field injected by caller
                injectedMaliciousField: "<script>hack()</script>",
            };

            const content = await renderNotificationContent(
                mockPrisma,
                "ws_A",
                NotificationEventType.WORK_ORDER_ASSIGNED,
                NotificationChannel.EMAIL,
                payload,
            );

            expect(content.subject).toBe(
                "Assignment: Work Order WO-101 - Emergency Pipe Leak",
            );
            expect(content.body).toBe(
                "Work Order WO-101 (Emergency Pipe Leak) has been assigned to Alice &amp; Bob with priority HIGH.",
            );
            expect(content.bodyHtml).toContain("<strong>WO-101</strong>");
            expect(content.bodyHtml).toContain("<strong>Alice &amp; Bob</strong>");
        });

        it("renders IN_APP notification without subject", async () => {
            mockPrisma.notificationTemplate.findFirst.mockResolvedValue(null);

            const payload = {
                workOrderId: "wo_101",
                workOrderNumber: "WO-101",
                title: "Boiler Service",
                customerId: "cust_1",
                priority: "MEDIUM",
            };

            const content = await renderNotificationContent(
                mockPrisma,
                "ws_A",
                NotificationEventType.WORK_ORDER_CREATED,
                NotificationChannel.IN_APP,
                payload,
            );

            expect(content.subject).toBeUndefined();
            expect(content.body).toBe(
                "Work Order WO-101 (Boiler Service) has been created with MEDIUM priority.",
            );
        });
    });

    describe("5. Workspace Custom Template Management CRUD & RBAC", () => {
        it("creates custom template with write-time token validation for ADMIN", async () => {
            mockPrisma.workspaceMember.findFirst.mockResolvedValue({
                id: "admin_1",
                workspaceId: "ws_A",
                role: MembershipRole.ADMIN,
                status: "ACTIVE",
            });

            mockPrisma.notificationTemplate.upsert.mockResolvedValue({
                id: "tmpl_new",
                workspaceId: "ws_A",
                eventType: NotificationEventType.INVOICE_SENT,
                channel: NotificationChannel.EMAIL,
                locale: "en",
                subject: "Custom Invoice {{invoiceNumber}} (Total: {{totalAmount}})",
                bodyText: "Invoice {{invoiceNumber}} due on {{dueDate}}.",
                isActive: true,
            });

            const result = await createNotificationTemplate(
                mockPrisma,
                "ws_A",
                {
                    eventType: NotificationEventType.INVOICE_SENT,
                    channel: NotificationChannel.EMAIL,
                    locale: "en",
                    subject: "Custom Invoice {{invoiceNumber}} (Total: {{totalAmount}})",
                    bodyText: "Invoice {{invoiceNumber}} due on {{dueDate}}.",
                },
                "admin_1",
            );

            expect(result.id).toBe("tmpl_new");
            expect(mockPrisma.notificationTemplate.upsert).toHaveBeenCalled();
        });

        it("rejects custom template creation if template contains illegal tokens at write time", async () => {
            mockPrisma.workspaceMember.findFirst.mockResolvedValue({
                id: "admin_1",
                workspaceId: "ws_A",
                role: MembershipRole.ADMIN,
                status: "ACTIVE",
            });

            await expect(
                createNotificationTemplate(
                    mockPrisma,
                    "ws_A",
                    {
                        eventType: NotificationEventType.INVOICE_SENT,
                        channel: NotificationChannel.EMAIL,
                        subject: "Invoice {{invoiceNumber}} with secret {{internalBankVaultCode}}",
                        bodyText: "Please pay immediately.",
                    },
                    "admin_1",
                ),
            ).rejects.toThrow(NotificationTemplateCompilationError);
        });

        it("enforces RBAC: non-admin member cannot create custom templates", async () => {
            mockPrisma.workspaceMember.findFirst.mockResolvedValue({
                id: "tech_1",
                workspaceId: "ws_A",
                role: MembershipRole.TECHNICIAN,
                status: "ACTIVE",
            });

            await expect(
                createNotificationTemplate(
                    mockPrisma,
                    "ws_A",
                    {
                        eventType: NotificationEventType.INVOICE_SENT,
                        channel: NotificationChannel.EMAIL,
                        bodyText: "Invoice {{invoiceNumber}}.",
                    },
                    "tech_1",
                ),
            ).rejects.toThrow(NotificationActorUnauthorizedError);
        });

        it("updates custom template and validates tokens on update", async () => {
            mockPrisma.workspaceMember.findFirst.mockResolvedValue({
                id: "owner_1",
                workspaceId: "ws_A",
                role: MembershipRole.OWNER,
                status: "ACTIVE",
            });

            mockPrisma.notificationTemplate.findFirst.mockResolvedValue({
                id: "tmpl_1",
                workspaceId: "ws_A",
                eventType: NotificationEventType.INVOICE_SENT,
            });

            mockPrisma.notificationTemplate.update.mockResolvedValue({
                id: "tmpl_1",
                subject: "Updated {{invoiceNumber}} Subject",
            });

            const updated = await updateNotificationTemplate(
                mockPrisma,
                "ws_A",
                "tmpl_1",
                {
                    subject: "Updated {{invoiceNumber}} Subject",
                },
                "owner_1",
            );

            expect(updated.id).toBe("tmpl_1");
            expect(mockPrisma.notificationTemplate.update).toHaveBeenCalled();
        });

        it("lists custom templates for a workspace", async () => {
            mockPrisma.notificationTemplate.findMany.mockResolvedValue([
                { id: "tmpl_1", workspaceId: "ws_A" },
            ]);

            const list = await listNotificationTemplates(mockPrisma, "ws_A");
            expect(list.length).toBe(1);
            expect(mockPrisma.notificationTemplate.findMany).toHaveBeenCalledWith({
                where: { workspaceId: "ws_A" },
                orderBy: [{ eventType: "asc" }, { channel: "asc" }],
            });
        });

        it("soft-deactivates template via isActive: false", async () => {
            mockPrisma.workspaceMember.findFirst.mockResolvedValue({
                id: "admin_1",
                workspaceId: "ws_A",
                role: MembershipRole.ADMIN,
                status: "ACTIVE",
            });

            mockPrisma.notificationTemplate.findFirst.mockResolvedValue({
                id: "tmpl_1",
                workspaceId: "ws_A",
                eventType: NotificationEventType.WORK_ORDER_CREATED,
            });

            mockPrisma.notificationTemplate.update.mockResolvedValue({
                id: "tmpl_1",
                isActive: false,
            });

            const deactivated = await deactivateNotificationTemplate(
                mockPrisma,
                "ws_A",
                "tmpl_1",
                "admin_1",
            );

            expect(deactivated.isActive).toBe(false);
            expect(mockPrisma.notificationTemplate.update).toHaveBeenCalledWith({
                where: { id: "tmpl_1" },
                data: { isActive: false },
            });
        });
    });
});
