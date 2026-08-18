import { requireActiveUser } from "./requireActiveUser";

export async function requireVerifiedUser() {
    return requireActiveUser();
}