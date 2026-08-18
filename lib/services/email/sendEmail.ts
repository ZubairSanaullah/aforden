import {
    getEmailProvider,
} from "./provider";

import type {
    SendEmailInput,
    EmailSendResult,
} from "./types";

export async function sendEmail(
    input: SendEmailInput
): Promise<EmailSendResult> {
    if (!input.to) {
        throw new Error(
            "Email recipient is required."
        );
    }

    if (!input.subject?.trim()) {
        throw new Error(
            "Email subject is required."
        );
    }

    if (!input.html?.trim()) {
        throw new Error(
            "Email HTML content is required."
        );
    }

    const provider =
        getEmailProvider();

    return provider.send(input);
}