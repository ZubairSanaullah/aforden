/**
 * Phase 1.18.17 — Registration-Time Webhook URL Syntactic Validation
 *
 * Enforces syntactic and pattern-based network boundaries on webhook endpoint registrations
 * to reject obvious internal services, loopback devices, private RFC 1918 subnets, and
 * cloud instance metadata endpoints.
 *
 * NOTE ON SSRF DEFENSE LAYERS & KNOWN GAP (DEFERRED TO PHASE 1.18.18):
 * -------------------------------------------------------------------
 * This function is a necessary-but-not-sufficient FIRST LAYER of defense operating at
 * REGISTRATION TIME via string/hostname/IP-literal matching. It does not perform live DNS
 * resolution and therefore cannot prevent:
 * 1. DNS Rebinding Attacks: A public hostname (e.g. attacker.com) that points to a public IP
 *    during registration, but whose DNS record is subsequently repointed to 169.254.169.254
 *    or 127.0.0.1 before/during actual delivery.
 * 2. Time-Of-Check to Time-Of-Use (TOCTOU) Gaps: Changes in network routing or DNS resolution
 *    between registration and outbound HTTP dispatch.
 * 3. HTTP 301/302 Redirect-Based SSRF: Receiving servers redirecting to internal IP addresses.
 *
 * HARD REQUIREMENT FOR PHASE 1.18.18 (DELIVERY DISPATCHER):
 * Phase 1.18.18's dispatcher MUST perform pre-connect DNS resolution and validate the RESOLVED
 * IP address immediately before opening the outbound socket/TLS connection, and re-validate
 * all HTTP redirect targets before following.
 */

export class InvalidWebhookUrlError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidWebhookUrlError";
    }
}

/**
 * Checks if an IPv4 address string falls into private, loopback, or link-local ranges.
 */
export function isPrivateOrReservedIpv4(ip: string): boolean {
    const parts = ip.split(".").map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
        return false;
    }

    const [a, b] = parts;

    // 0.0.0.0/8 (Current network)
    if (a === 0) return true;

    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;

    // 10.0.0.0/8 (Private RFC 1918)
    if (a === 10) return true;

    // 172.16.0.0/12 (Private RFC 1918: 172.16.0.0 - 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) return true;

    // 192.168.0.0/16 (Private RFC 1918)
    if (a === 192 && b === 168) return true;

    // 169.254.0.0/16 (Link-Local & Cloud Metadata 169.254.169.254)
    if (a === 169 && b === 254) return true;

    // 100.64.0.0/10 (Carrier-Grade NAT)
    if (a === 100 && b >= 64 && b <= 127) return true;

    // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (TEST-NET)
    if (a === 192 && b === 0 && parts[2] === 2) return true;
    if (a === 198 && b === 51 && parts[2] === 100) return true;
    if (a === 203 && b === 0 && parts[2] === 113) return true;

    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (a >= 224) return true;

    return false;
}

/**
 * Checks if an IPv6 address string is private, loopback, or link-local.
 */
export function isPrivateOrReservedIpv6(host: string): boolean {
    const cleanHost = host.replace(/^\[|\]$/g, "").toLowerCase();

    // Loopback
    if (cleanHost === "::1" || cleanHost === "0:0:0:0:0:0:0:1" || cleanHost === "::") {
        return true;
    }

    // Unique Local Addresses (fc00::/7 -> fc00... to fdff...)
    if (cleanHost.startsWith("fc") || cleanHost.startsWith("fd")) {
        return true;
    }

    // Link-Local (fe80::/10 -> fe80... to febf...)
    if (
        cleanHost.startsWith("fe8") ||
        cleanHost.startsWith("fe9") ||
        cleanHost.startsWith("fea") ||
        cleanHost.startsWith("feb")
    ) {
        return true;
    }

    // IPv4-mapped IPv6 (::ffff:127.0.0.1 etc.)
    if (cleanHost.startsWith("::ffff:")) {
        const ipv4Part = cleanHost.substring(7);
        if (isPrivateOrReservedIpv4(ipv4Part)) {
            return true;
        }
    }

    return false;
}

const RESERVED_INTERNAL_TLDS = [
    ".local",
    ".internal",
    ".lan",
    ".corp",
    ".test",
    ".example",
    ".invalid",
    ".home",
    ".arpa",
    ".localhost",
];

/**
 * Validates a webhook URL against SSRF and protocol requirements.
 * Throws InvalidWebhookUrlError on any violation.
 */
export function validateWebhookUrl(rawUrl: string): string {
    if (!rawUrl || typeof rawUrl !== "string") {
        throw new InvalidWebhookUrlError("Webhook URL must be a non-empty string.");
    }

    const trimmed = rawUrl.trim();

    if (trimmed.length > 1024) {
        throw new InvalidWebhookUrlError("Webhook URL must not exceed 1024 characters.");
    }

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new InvalidWebhookUrlError(
            `Invalid webhook URL format: '${trimmed}'. Must be a valid absolute URL.`,
        );
    }

    // 1. Protocol requirement: HTTPS only
    if (parsed.protocol !== "https:") {
        throw new InvalidWebhookUrlError(
            `Webhook URL protocol must be 'https:'. Received '${parsed.protocol}'. Non-encrypted HTTP and other schemes are strictly forbidden.`,
        );
    }

    // 2. Embedded credentials rejection
    if (parsed.username || parsed.password) {
        throw new InvalidWebhookUrlError(
            "Webhook URL must not contain embedded user credentials (username/password).",
        );
    }

    const hostname = parsed.hostname.toLowerCase();

    // 3. Localhost and Loopback names
    if (
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname === "ip6-localhost" ||
        hostname === "ip6-loopback"
    ) {
        throw new InvalidWebhookUrlError(
            `Webhook URL target '${hostname}' is a loopback address and is forbidden.`,
        );
    }

    // 4. Cloud metadata specific hostnames
    if (
        hostname === "metadata.google.internal" ||
        hostname === "instance-data" ||
        hostname === "metadata"
    ) {
        throw new InvalidWebhookUrlError(
            `Webhook URL target '${hostname}' is a cloud instance metadata endpoint and is forbidden.`,
        );
    }

    // 5. Reserved internal TLDs
    for (const tld of RESERVED_INTERNAL_TLDS) {
        if (hostname.endsWith(tld)) {
            throw new InvalidWebhookUrlError(
                `Webhook URL target '${hostname}' uses a private/internal top-level domain (${tld}) and is forbidden.`,
            );
        }
    }

    // 6. Single-label internal hostnames (e.g., "httpbin", "backend", "db", "redis")
    if (!hostname.includes(".") && !hostname.startsWith("[")) {
        throw new InvalidWebhookUrlError(
            `Webhook URL target '${hostname}' is a single-label internal hostname and is forbidden. Must be a fully-qualified domain name (FQDN) or public IP.`,
        );
    }

    // 7. IPv4 addresses
    const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
    if (isIpv4) {
        if (isPrivateOrReservedIpv4(hostname)) {
            throw new InvalidWebhookUrlError(
                `Webhook URL target IP '${hostname}' is in a private, loopback, or reserved IP subnet and is forbidden.`,
            );
        }
    }

    // 8. IPv6 addresses
    if (hostname.startsWith("[") || hostname.includes(":")) {
        if (isPrivateOrReservedIpv6(hostname)) {
            throw new InvalidWebhookUrlError(
                `Webhook URL target IPv6 '${hostname}' is in a private, loopback, or link-local subnet and is forbidden.`,
            );
        }
    }

    return parsed.toString();
}
