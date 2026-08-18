export class AuthenticationRequiredError
    extends Error {
    constructor(
        message = "Authentication is required."
    ) {
        super(message);

        this.name =
            "AuthenticationRequiredError";
    }
}

export class EmailVerificationRequiredError
    extends Error {
    constructor(
        message =
            "Email verification is required."
    ) {
        super(message);

        this.name =
            "EmailVerificationRequiredError";
    }
}

export class AccountInactiveError
    extends Error {
    constructor(
        message =
            "Your account is not active."
    ) {
        super(message);

        this.name =
            "AccountInactiveError";
    }
}