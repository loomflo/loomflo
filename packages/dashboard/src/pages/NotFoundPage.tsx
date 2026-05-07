import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <main
      style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 32,
      }}
    >
      <h1 style={{ margin: 0 }}>404</h1>
      <p style={{ margin: 0, color: "var(--fg-3)" }}>
        Cette page n'existe pas — ou plus.
      </p>
      <Link
        to="/projects"
        style={{
          marginTop: 8,
          color: "var(--color-brand-primary)",
          textDecoration: "none",
          fontWeight: 500,
        }}
      >
        Retour aux projets &nbsp;→
      </Link>
    </main>
  );
}
