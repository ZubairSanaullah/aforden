import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

import {
    AuthenticationRequiredError,
    EmailVerificationRequiredError,
    AccountInactiveError,
} from "./authErrors";

export async function requireActiveUser() {
    const session =
        await auth();

    if (!session?.user?.id) {
        throw new AuthenticationRequiredError();
    }

    const user =
        await prisma.user.findUnique({
            where: {
                id: session.user.id,
            },
            select: {
                id: true,
                name: true,
                email: true,
                status: true,
                emailVerified: true,
                avatarUrl: true,
            },
        });

    if (!user) {
        throw new AuthenticationRequiredError(
            "User account could not be found."
        );
    }

    if (!user.emailVerified) {
        throw new EmailVerificationRequiredError();
    }

    if (
        user.status !== "ACTIVE"
    ) {
        throw new AccountInactiveError();
    }

    return user;
}