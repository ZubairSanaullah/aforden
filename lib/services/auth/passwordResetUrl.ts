const DEFAULT_APP_URL =
    "http://localhost:3000";

function getAppUrl(): string {
    const appUrl =
        process.env.NEXT_PUBLIC_APP_URL?.trim() ||
        process.env.AUTH_URL?.trim() ||
        DEFAULT_APP_URL;

    return appUrl.replace(/\/+$/, "");
}

export function createPasswordResetUrl(
    token: string
): string {
    const url = new URL(
        "/reset-password",
        getAppUrl()
    );

    url.searchParams.set(
        "token",
        token
    );

    return url.toString();
}