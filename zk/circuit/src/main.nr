// Janus income proof. Owner: Sam.
//
// Proves "median monthly recurring income >= multiple x rent" over a list of bank deposits
// WITHOUT revealing the deposits. The deposits are private inputs; the proof is tied to
//   - `commitment`: a Pedersen hash of the deposit list plus a per-request salt. The bank
//     signs this hash, so the tenant can't swap in invented deposits (the landlord checks the
//     bank's signature). The salt keeps the same deposits from hashing the same at two landlords.
//   - `today`, `rent_cents`, `multiple_x100`: fixed by the landlord's request, not the tenant.
//   - `request_tag`: hash of the request's one-time code, so a proof can't be reused elsewhere.
// The rule mirrors tenant-app/lib/income.ts: last 90 days, only payers seen 3+ times,
// three 30-day months, median month >= multiple x rent.

global MAX_DEPOSITS: u32 = 32;
global WINDOW_DAYS: u32 = 90;
global MIN_OCCURRENCES: u32 = 3;

fn main(
    amounts: [u64; 32],      // whole cents
    days: [u32; 32],         // days since 1970-01-01 (UTC)
    payers: [Field; 32],     // opaque payer id: same employer -> same id
    count: u32,              // how many of the 32 slots hold a real deposit (rest are zero padding)
    salt: Field,             // random per request; never revealed
    commitment: pub Field,
    today: pub u32,
    rent_cents: pub u64,
    multiple_x100: pub u32,  // 300 means income must be at least 3.00 x rent
    request_tag: pub Field,
) -> pub bool {
    assert(count <= MAX_DEPOSITS);
    assert(today >= WINDOW_DAYS);
    // request_tag only binds the proof to one request; it takes part in no arithmetic.
    assert(request_tag == request_tag);

    // 1. The deposits must be exactly the list the bank signed.
    let mut preimage: [Field; 98] = [0; 98];
    preimage[0] = salt;
    preimage[1] = count as Field;
    for i in 0..MAX_DEPOSITS {
        preimage[2 + i] = amounts[i] as Field;
        preimage[34 + i] = days[i] as Field;
        preimage[66 + i] = payers[i];
    }
    let hash = std::hash::pedersen_hash(preimage);
    assert(hash == commitment);

    // 2. Which deposits fall in the 90-day window?
    let start = today - WINDOW_DAYS;
    let mut active: [bool; 32] = [false; 32];
    for i in 0..MAX_DEPOSITS {
        active[i] = (i < count) & (days[i] >= start) & (days[i] <= today);
    }

    // 3. Only recurring payers count; bucket their deposits into three 30-day months.
    let mut month0: u64 = 0;
    let mut month1: u64 = 0;
    let mut month2: u64 = 0;
    for i in 0..MAX_DEPOSITS {
        let mut occurrences: u32 = 0;
        for j in 0..MAX_DEPOSITS {
            if active[i] & active[j] & (payers[i] == payers[j]) {
                occurrences += 1;
            }
        }
        let recurring = active[i] & (occurrences >= MIN_OCCURRENCES);
        // Field arithmetic can't underflow; only used when active (days[i] <= today).
        let days_ago = ((today as Field) - (days[i] as Field)) as u32;
        let bucket = days_ago / 30;
        if recurring & (bucket == 0) {
            month0 += amounts[i];
        }
        if recurring & (bucket == 1) {
            month1 += amounts[i];
        }
        if recurring & (bucket >= 2) {
            month2 += amounts[i];
        }
    }

    // 4. Median of the three months.
    let max01 = if month0 > month1 { month0 } else { month1 };
    let min01 = if month0 > month1 { month1 } else { month0 };
    let max = if max01 > month2 { max01 } else { month2 };
    let min = if min01 < month2 { min01 } else { month2 };
    let median = month0 + month1 + month2 - max - min;

    // 5. median >= multiple x rent   (both sides scaled by 100 to keep the multiple exact)
    median * 100 >= (multiple_x100 as u64) * rent_cents
}
