export interface EmailAddress {
    email: string;
    name?: string;
}

export interface SendEmailInput {
    to: EmailAddress | EmailAddress[];
    subject: string;
    html: string;
    text?: string;
}

export interface EmailSendResult {
    success: boolean;
    messageId?: string;
}

export interface EmailProvider {
    readonly name?: string;
    send(
        input: SendEmailInput
    ): Promise<EmailSendResult>;
}