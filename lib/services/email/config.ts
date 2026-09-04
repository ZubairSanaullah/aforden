const DEFAULT_FROM_NAME = "Aforden";

export function getEmailFromAddress(): {
    name: string;
    email: string;
} {
    const email =
        process.env.EMAIL_FROM?.trim() ||
        process.env.EMAIL_FROM_ADDRESS?.trim();

    if (!email) {
        throw new Error(
            "EMAIL_FROM environment variable is not configured."
        );
    }

    return {
        name:
            process.env.EMAIL_FROM_NAME?.trim() ||
            DEFAULT_FROM_NAME,
        email,
    };
}