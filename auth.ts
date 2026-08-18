import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcrypt";

import { prisma } from "@/lib/prisma";

export const {
    handlers,
    signIn,
    signOut,
    auth,
} = NextAuth({
    adapter: PrismaAdapter(prisma),

    session: {
        strategy: "database",
    },

    providers: [
        Credentials({
            name: "Credentials",

            credentials: {
                email: {
                    label: "Email",
                    type: "email",
                },

                password: {
                    label: "Password",
                    type: "password",
                },
            },

            async authorize(credentials) {
                if (
                    typeof credentials?.email !==
                    "string" ||
                    typeof credentials?.password !==
                    "string"
                ) {
                    return null;
                }

                const email =
                    credentials.email
                        .toLowerCase()
                        .trim();

                const user =
                    await prisma.user.findUnique({
                        where: {
                            email,
                        },
                    });

                if (
                    !user ||
                    !user.passwordHash
                ) {
                    return null;
                }

                if (
                    user.status !==
                    "ACTIVE"
                ) {
                    return null;
                }

                if (
                    !user.emailVerified
                ) {
                    return null;
                }

                const passwordMatches =
                    await bcrypt.compare(
                        credentials.password,
                        user.passwordHash
                    );

                if (!passwordMatches) {
                    return null;
                }

                return {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    image: user.avatarUrl,
                };
            },
        }),
    ],

    callbacks: {
        async session({
            session,
            user,
        }) {
            if (!session.user) {
                return session;
            }

            const databaseUser =
                await prisma.user.findUnique({
                    where: {
                        id: user.id,
                    },
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        avatarUrl: true,
                        status: true,
                        emailVerified: true,
                    },
                });

            if (
                !databaseUser ||
                databaseUser.status !==
                "ACTIVE" ||
                !databaseUser.emailVerified
            ) {
                return {
                    ...session,
                    user: {
                        ...session.user,
                        id: user.id,
                    },
                };
            }

            session.user.id =
                databaseUser.id;

            session.user.name =
                databaseUser.name;

            session.user.email =
                databaseUser.email;

            session.user.image =
                databaseUser.avatarUrl;

            return session;
        },
    },
});