/** Validação/normalização de CPF, CNPJ e datas. */

export function onlyDigits(v: string): string {
  return (v || "").replace(/\D/g, "");
}

export function isValidCPF(cpf: string): boolean {
  const c = onlyDigits(cpf);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += parseInt(c[i]) * (len + 1 - i);
    const d = (sum * 10) % 11;
    return d === 10 ? 0 : d;
  };
  return calc(9) === parseInt(c[9]) && calc(10) === parseInt(c[10]);
}

export function isValidCNPJ(cnpj: string): boolean {
  const c = onlyDigits(cnpj);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (len: number) => {
    const w = len === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += parseInt(c[i]) * w[i];
    const d = sum % 11;
    return d < 2 ? 0 : 11 - d;
  };
  return calc(12) === parseInt(c[12]) && calc(13) === parseInt(c[13]);
}

export function maskCPF(cpf: string): string {
  const c = onlyDigits(cpf);
  return c.length === 11 ? `${c.slice(0,3)}.***.***-${c.slice(9)}` : "***";
}
