export default function Home() {
  return (
    <main>
      <h1>Answer one question</h1>
      <p className="sub">
        Open the link from your landlord. Janus checks the answer on this device and can send back only a signed yes or no.
      </p>
      <section className="card">
        <h2>Nothing is shared until you approve</h2>
        <ul className="plain">
          <li>No documents or statements</li>
          <li>No balances, deposits, or dollar amounts</li>
          <li>No bank login for the landlord</li>
        </ul>
        <p className="empty">This page is waiting for a request link. There is nothing to approve here.</p>
      </section>
    </main>
  );
}
