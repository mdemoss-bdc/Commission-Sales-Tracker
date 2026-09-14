"use client";

import Link from "next/link";

type BrandHomeLinkProps = {
  pageTitle?: string;
  headingId?: string;
};

export function BrandHomeLink({ pageTitle, headingId }: BrandHomeLinkProps) {
  return (
    <div className="brand-block">
      <Link href="/" className={pageTitle ? "brand-home brand-home-inline" : "brand-home"}>
        <span className="workbook-kicker">Sales commission</span>
        {pageTitle ? (
          <>
            <span className="brand-divider" aria-hidden="true">
              /
            </span>
            <span className="brand-wordmark">Pay Tracker</span>
          </>
        ) : (
          <h1 id={headingId}>Pay Tracker</h1>
        )}
      </Link>
      {pageTitle ? <h1 id={headingId}>{pageTitle}</h1> : null}
    </div>
  );
}
