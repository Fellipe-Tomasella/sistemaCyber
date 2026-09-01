/** Helpers de data (ISO yyyy-mm-dd). */

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addMonths(isoDate: string, months: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function isPast(isoDate: string): boolean {
  return isoDate < today();
}

/** Formata centavos como BRL. */
export function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
