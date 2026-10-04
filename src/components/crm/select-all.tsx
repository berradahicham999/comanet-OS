"use client";

/** Case « tout cocher » pour les cases `name` d'un même formulaire. */
export function SelectAll({ name, form }: { name: string; form: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Tout cocher"
      onChange={(e) => {
        const f = document.getElementById(form) as HTMLFormElement | null;
        f?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`).forEach((c) => { c.checked = e.currentTarget.checked; });
      }}
    />
  );
}
