/**
 * Phase 1.13.5 — Safe Token Interpolation Engine
 * Token replacement engine enforcing token whitelists, HTML escaping, and zero-eval guarantees.
 */

import { NotificationTemplateCompilationError } from "./notificationErrors";

const TOKEN_REGEX = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Escapes special HTML characters to prevent XSS in rendered notification templates.
 */
export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Extracts all unique token names from a template string (e.g. "Hello {{name}}" -> ["name"]).
 */
export function extractTemplateTokens(templateString: string): string[] {
    const tokens: string[] = [];
    const regex = new RegExp(TOKEN_REGEX.source, "g");
    let match: RegExpExecArray | null;

    while ((match = regex.exec(templateString)) !== null) {
        if (match[1] && !tokens.includes(match[1])) {
            tokens.push(match[1]);
        }
    }

    return tokens;
}

/**
 * Validates that all tokens in a template string exist within the event type's variable whitelist.
 * Throws NotificationTemplateCompilationError on any illegal token.
 */
export function validateTemplateTokens(
    templateString: string | null | undefined,
    allowedWhitelist: string[],
    contextField = "template",
): void {
    if (!templateString) return;

    const tokens = extractTemplateTokens(templateString);
    for (const token of tokens) {
        if (!allowedWhitelist.includes(token)) {
            throw new NotificationTemplateCompilationError(
                `Illegal token '{{${token}}}' in ${contextField}. Allowed variables for this event are: ${allowedWhitelist.join(", ")}`,
            );
        }
    }
}

/**
 * Safely renders a template string by replacing {{token}} placeholders with HTML-escaped variables.
 *
 * Requirements:
 * - Match tokens via /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g only.
 * - Any token not in `allowedWhitelist` throws NotificationTemplateCompilationError.
 * - Missing (undefined/null) values for a whitelisted token render as empty string "".
 * - All interpolated values are HTML-escaped.
 * - Zero eval(), zero dynamic code execution.
 */
export function renderTemplate(
    templateString: string,
    variables: Record<string, string | number | boolean | null | undefined>,
    allowedWhitelist: string[],
): string {
    if (!templateString) {
        return "";
    }

    return templateString.replace(TOKEN_REGEX, (_match, tokenName: string) => {
        if (!allowedWhitelist.includes(tokenName)) {
            throw new NotificationTemplateCompilationError(
                `Unrecognized or unauthorized token '{{${tokenName}}}' encountered during template compilation. Allowed variables: ${allowedWhitelist.join(", ")}`,
            );
        }

        const rawValue = variables[tokenName];

        if (rawValue === undefined || rawValue === null) {
            return "";
        }

        const stringValue = String(rawValue);
        return escapeHtml(stringValue);
    });
}
