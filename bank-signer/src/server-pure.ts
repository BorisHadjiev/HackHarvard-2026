// Pure helpers for the bank signer (no server, no env), so they can be unit tested.
import { dayNumber, payerId, MAX_DEPOSITS, type ZkDeposit } from "@ntk/zk";

/** Convert deposits to what the circuit sees. Payer names become opaque ids; dates become day numbers. */
export function toZkDeposits(deposits: { payer: string; amount: number; date: string }[]): ZkDeposit[] {
  return deposits
    .map((d) => ({ amountCents: Math.round(d.amount * 100), day: dayNumber(d.date), payer: payerId(d.payer) }))
    .sort((a, b) => b.day - a.day)
    .slice(0, MAX_DEPOSITS); // newest first; an income check only needs the last 90 days
}

