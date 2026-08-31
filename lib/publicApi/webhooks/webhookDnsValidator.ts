/**
 * Phase 1.18.18 — Pre-Connect DNS Resolution & IP Validation (SSRF & DNS Rebinding Mitigation)
 *
 * Performs fresh, live DNS resolution immediately before establishing each outbound connection.
 * Validates every resolved IP address against forbidden subnets (loopback, private RFC 1918,
 * link-local, cloud metadata 169.254.169.254, etc.) to defeat DNS rebinding attacks.
 */

import dns from "node:dns/promises";
import {
    isPrivateOrReservedIpv4,
    isPrivateOrReservedIpv6,
} from "./webhookUrlValidation";

export class DeliverySsrfBlockedError extends Error {
    public readonly forbiddenIp: string;

    constructor(message: string, forbiddenIp: string) {
        super(message);
        this.name = "DeliverySsrfBlockedError";
        this.forbiddenIp = forbiddenIp;
    }
}

export class DeliveryDnsResolutionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DeliveryDnsResolutionError";
    }
}

export type DnsLookupFunction = (hostname: string) => Promise<string[]>;

/**
 * Default live DNS resolver using Node's dns/promises.
 */
export async function defaultDnsResolver(hostname: string): Promise<string[]> {
    // If hostname is already an IPv4 literal
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
        return [hostname];
    }

    // If hostname is an IPv6 literal
    if (hostname.startsWith("[") || hostname.includes(":")) {
        return [hostname.replace(/^\[|\]$/g, "")];
    }

    try {
        const results = await dns.lookup(hostname, { all: true });
        return results.map((r) => r.address);
    } catch (err: any) {
        throw new DeliveryDnsResolutionError(
            `Failed to resolve DNS for webhook host '${hostname}': ${err.message || String(err)}`,
        );
    }
}

/**
 * Resolves destination hostname to IP addresses and verifies that NONE of the resolved IPs
 * fall into private, loopback, link-local, or cloud metadata subnets.
 *
 * @param hostname Destination hostname extracted from endpoint URL.
 * @param customResolver Optional DNS lookup function (for testing / mocking).
 * @returns Array of validated public IP addresses.
 * @throws DeliverySsrfBlockedError if any resolved IP address is in a private/metadata range.
 * @throws DeliveryDnsResolutionError if DNS lookup fails or returns 0 addresses.
 */
export async function resolveAndValidateWebhookIp(
    hostname: string,
    customResolver?: DnsLookupFunction,
): Promise<string[]> {
    const resolver = customResolver || defaultDnsResolver;
    const cleanHostname = hostname.replace(/^\[|\]$/g, "").toLowerCase();

    const resolvedIps = await resolver(cleanHostname);

    if (!resolvedIps || resolvedIps.length === 0) {
        throw new DeliveryDnsResolutionError(
            `DNS lookup for '${cleanHostname}' returned zero IP addresses.`,
        );
    }

    for (const ip of resolvedIps) {
        const cleanIp = ip.replace(/^\[|\]$/g, "").toLowerCase();

        // 1. Check IPv4 private/loopback/metadata subnets
        if (cleanIp.includes(".")) {
            if (isPrivateOrReservedIpv4(cleanIp)) {
                throw new DeliverySsrfBlockedError(
                    `Destination hostname '${cleanHostname}' resolved to forbidden IP '${cleanIp}' (private, loopback, or cloud instance metadata). Outbound delivery blocked to prevent SSRF / DNS rebinding.`,
                    cleanIp,
                );
            }
        }

        // 2. Check IPv6 private/loopback subnets
        if (cleanIp.includes(":")) {
            if (isPrivateOrReservedIpv6(cleanIp)) {
                throw new DeliverySsrfBlockedError(
                    `Destination hostname '${cleanHostname}' resolved to forbidden IPv6 '${cleanIp}' (private, loopback, or link-local). Outbound delivery blocked to prevent SSRF / DNS rebinding.`,
                    cleanIp,
                );
            }
        }
    }

    return resolvedIps;
}
