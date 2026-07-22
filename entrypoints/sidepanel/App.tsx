import { EXTENSION_NAME } from '@sitecapsule/shared';

const runtimeSurfaces = [
  ['Background', 'Ready'],
  ['Content', 'Runtime'],
  ['Offscreen', 'Standby'],
] as const;

export function App() {
  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">{EXTENSION_NAME}</p>
          <h1>Archive workspace</h1>
        </div>
        <span className="status-badge">Foundation</span>
      </header>

      <section className="runtime-section" aria-labelledby="runtime-title">
        <div className="section-heading">
          <h2 id="runtime-title">Runtime surfaces</h2>
          <span>v0.1.0</span>
        </div>
        <dl className="runtime-list">
          {runtimeSurfaces.map(([name, status]) => (
            <div className="runtime-row" key={name}>
              <dt>{name}</dt>
              <dd>{status}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
