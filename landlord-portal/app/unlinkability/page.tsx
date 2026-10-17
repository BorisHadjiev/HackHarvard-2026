// Side-by-side unlinkability demo. Owner: Boris (UI).
// Uses pairwiseSubject as-is. Demo labels are not real tenant secrets and are not stored on a claim.
import { pairwiseSubject } from "@ntk/shared";

const LANDLORDS = [
  { id: "harbor-view", name: "Harbor View" },
  { id: "northline", name: "Northline Realty" },
];

const TENANTS = [
  { id: "demo-tenant-a", label: "Tenant A" },
  { id: "demo-tenant-b", label: "Tenant B" },
];

export default async function UnlinkabilityPage() {
  const columns = await Promise.all(
    LANDLORDS.map(async (landlord) => ({
      landlord,
      rows: await Promise.all(
        TENANTS.map(async (tenant) => ({
          tenant: tenant.label,
          sub: await pairwiseSubject(tenant.id, landlord.id),
        })),
      ),
    })),
  );

  return (
    <main>
      <header className="top">
        <a className="mark" href="/">Need-to-Know</a>
        <span className="role">Demo</span>
      </header>
      <h1>Same person. Different id.</h1>
      <p className="sub">
        Each landlord only receives a pairwise subject. Pooling the four values does not show which two came from the same tenant.
      </p>
      <div className="cols">
        {columns.map((column) => (
          <section className="card" key={column.landlord.id}>
            <h2>{column.landlord.name}</h2>
            {column.rows.map((row) => (
              <p className="pair" key={row.tenant}>
                <b>{row.tenant}</b>
                <span className="mono">{row.sub}</span>
              </p>
            ))}
          </section>
        ))}
      </div>
      <p className="sub">These ids are computed for this screen only. They are not a signed claim, and no bank figure is included.</p>
    </main>
  );
}
