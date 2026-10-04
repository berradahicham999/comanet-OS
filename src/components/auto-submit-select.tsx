"use client";

/** Liste déroulante qui soumet son formulaire au changement (assistant du générateur : la marque recharge les produits). */
export function AutoSubmitSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
