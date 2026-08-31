/**
 * Developer Application & API Key domain error classes.
 */

export class DeveloperApplicationNotFoundError extends Error {
    constructor(message = "Developer application not found.") {
        super(message);
        this.name = "DeveloperApplicationNotFoundError";
    }
}

export class DeveloperApplicationInactiveError extends Error {
    constructor(message = "Developer application is not active.") {
        super(message);
        this.name = "DeveloperApplicationInactiveError";
    }
}

export class ApiKeyNotFoundError extends Error {
    constructor(message = "API key not found.") {
        super(message);
        this.name = "ApiKeyNotFoundError";
    }
}
