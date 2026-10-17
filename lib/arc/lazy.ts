"use client";

/** Code-split door to the passkey wallet: Circle's SDK loads the first time someone picks it, never on page view. */
import type * as Account from "./account";

let account: Promise<typeof Account> | null = null;
export const loadPasskeyAccount = () => (account ??= import("./account"));
