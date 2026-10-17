# Nessie integration

Checked against the official [Nessie docs](https://prod.nessieisreal.com/docs)
and their [OpenAPI specification](https://prod.nessieisreal.com/nessie-openapi-spec.yaml)
on October 17, 2026.

- `GET /accounts/{id}/deposits?key=...` returns a deposit array. Map `_id`
  to `id`, `description` to the local payroll label `payer`, `amount` to dollar
  `amount`, and `transaction_date` to `date`. Nessie does not document `payee_id`
  on a deposit. A description is a demo payroll label, not verified payer identity.
- `POST /customers?key=...` accepts `first_name`, `last_name`, and `address`.
  The address requires `street_number`, `street_name`, `city`, `state`, and `zip`.
- `POST /customers/{id}/accounts?key=...` accepts `type`, `nickname`, `rewards`,
  and `balance`. `Checking` is a documented account type.
- `POST /accounts/{id}/deposits?key=...` accepts `medium`, `transaction_date`,
  `status`, `amount`, and `description`. The seed uses `balance`, `completed`,
  integer dollar amounts, and ISO calendar dates. The same payload shape appears
  in the [official JavaScript SDK](https://github.com/nessieisreal/nessie-javascript-sdk/blob/master/lib/deposit.js).

The current OpenAPI spec describes creation responses only as success strings;
it does not specify an ID-bearing response schema. The seeder preserves support
for the existing `objectCreated._id` envelope and direct `_id` objects, and stops
with a clear error if a created customer or account has no ID. Confirm this
response shape against the configured sandbox before relying on a live seed.

## Seeding

Use Node.js 20.12+ (or 22+) for the native `.env` loader. Put these values in
`tenant-app/.env.local` (git-ignored):

```dotenv
NESSIE_API_KEY=your-api-key
NESSIE_BASE_URL=https://your-nessie-api-host
```

Set the actual API URL supplied for your sandbox; `BASE_URL_HERE` is a placeholder
and the seeder rejects it. An omitted URL retains the existing legacy default
`http://api.nessieisreal.com`. No sandbox host is silently substituted.

From the repository root, run `npx tsx scripts/seed-nessie.ts`. The script resolves
the env file relative to itself, so it also works from another working directory.
Exported shell variables take precedence over the file. It creates two customers,
two accounts, and fifteen deposits; reruns create additional demo data. Copy the
printed `NESSIE_ACCOUNT_MAYA` and `NESSIE_ACCOUNT_LEO` assignments into the same
env file. The script does not print the API key.

Tests mock every API request and use a temporary env file. They do not need a
Nessie key or create sandbox data. Run `npm test` at the repository root.
