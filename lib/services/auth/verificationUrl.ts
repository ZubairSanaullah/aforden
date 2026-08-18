const DEFAULT_APP_URL =
    "http://localhost:3000";

export function getAppUrl(): string {
    const appUrl =
        process.env.NEXT_PUBLIC_APP_URL?.trim() ||
        process.env.AUTH_URL?.trim() ||
        DEFAULT_APP_URL;

    return appUrl.replace(/\/+$/, "");
}

export function createVerificationUrl(
    token: string
): string {
    const url =
        new URL(
            "/verify-email",
            getAppUrl()
        );

    url.searchParams.set(
        "token",
        token
    );

    return url.toString();
}