/** Envelope padrão de resposta: { data, error, message }. */
export function ok<T>(data: T, message?: string) {
  return { data, error: null, message: message ?? null };
}
export function fail(message: string, error = "error") {
  return { data: null, error, message };
}

/** Erros de domínio com status HTTP. */
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const Errors = {
  Unauthorized: (m = "Não autenticado") => new ApiError(401, "unauthorized", m),
  Forbidden: (m = "Sem permissão") => new ApiError(403, "forbidden", m),
  NotFound: (m = "Não encontrado") => new ApiError(404, "not_found", m),
  BadRequest: (m = "Requisição inválida") => new ApiError(400, "bad_request", m),
  Conflict: (m = "Conflito") => new ApiError(409, "conflict", m),
  TooMany: (m = "Muitas tentativas. Tente novamente em instantes.") => new ApiError(429, "too_many_requests", m),
};
