/** Logique pure de décision (testée sans base). */
/** Vrai si le coût par résultat monte strictement sur `n` semaines consécutives (les dernières). */
export function isDegrading(points: { week: string; costPerResult: number | null }[], n: number): boolean {
  const xs = [...points].sort((a, b) => a.week.localeCompare(b.week)).map((p) => p.costPerResult);
  if (xs.length < n + 1) return false;
  const tail = xs.slice(-(n + 1));
  if (tail.some((v) => v === null)) return false;
  for (let i = 1; i < tail.length; i++) if ((tail[i] as number) <= (tail[i - 1] as number)) return false;
  return true;
}
