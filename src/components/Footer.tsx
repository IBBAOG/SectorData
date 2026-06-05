export default function Footer() {
  return (
    <footer
      className="border-top py-3 mt-auto"
      style={{ fontSize: 12, color: "#666", fontFamily: "Arial" }}
    >
      <div className="container d-flex justify-content-center flex-wrap gap-2">
        <div>&copy; {new Date().getFullYear()} IBBA O&amp;G — SectorData</div>
        {/*
          Footer links (Terms / Privacy / Contact) temporarily disabled
          until the legal docs pass legal review. To re-enable: restore the
          `import Link from "next/link";` line at the top, swap the wrapper
          back to `justify-content-between`, and uncomment the <nav> below.

          <nav className="d-flex gap-3">
            <Link href="/terms" className="text-decoration-none text-muted">
              Terms
            </Link>
            <Link href="/privacy" className="text-decoration-none text-muted">
              Privacy
            </Link>
            <a
              href="mailto:eduardo.mendes@itaubba.com"
              className="text-decoration-none text-muted"
            >
              Contact
            </a>
          </nav>
        */}
      </div>
    </footer>
  );
}
