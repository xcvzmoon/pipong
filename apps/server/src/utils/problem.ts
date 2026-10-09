const problemTitles = {
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  410: 'Gone',
  413: 'Content too large',
  415: 'Unsupported media type',
  422: 'Invalid request',
  429: 'Too many requests',
  503: 'Service unavailable',
} as const;

export function problemResponse(
  status: keyof typeof problemTitles,
  code: string,
  requestId: string,
): Response {
  return Response.json(
    {
      type: 'about:blank',
      title: problemTitles[status],
      status,
      code,
      requestId,
    },
    {
      status,
      headers: {
        'content-type': 'application/problem+json',
        'cache-control': 'no-store',
        'x-request-id': requestId,
      },
    },
  );
}
