export default function Home() {
  return (
    <main>
      <header className="top">
        <span className="mark">Need-to-Know</span>
        <span className="role">Tenant</span>
      </header>
      <h1>Your documents stay here.</h1>
      <p className="sub">Open the link from your landlord&apos;s text. This device answers one question and sends back a signed yes or no.</p>
      <div className="card empty">Waiting for a landlord link. There is nothing to approve until you open one.</div>
    </main>
  );
}
