export function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

export function unauthorized(message = "Unauthorized") {
  const error = new Error(message);
  error.status = 401;
  return error;
}

export function forbidden(message = "Forbidden") {
  const error = new Error(message);
  error.status = 403;
  return error;
}

export function notFound(message = "Resource not found") {
  const error = new Error(message);
  error.status = 404;
  return error;
}
