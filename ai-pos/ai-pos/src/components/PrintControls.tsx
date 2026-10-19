'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';

/** Print / back buttons for the receipt page (hidden when printing). */
export default function PrintControls({ autoPrint }: { autoPrint: boolean }) {
  useEffect(() => {
    if (!autoPrint) return;
    const t = setTimeout(() => window.print(), 500);
    return () => clearTimeout(t);
  }, [autoPrint]);

  return (
    <div className="mb-4 flex items-center justify-between print:hidden">
      <Link href="/pos" className="btn-secondary">
        <ArrowLeft className="h-4 w-4" /> Back to POS
      </Link>
      <button className="btn-primary" onClick={() => window.print()}>
        <Printer className="h-4 w-4" /> Print
      </button>
    </div>
  );
}
