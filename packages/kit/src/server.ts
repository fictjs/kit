export interface RequestHandlerOptions {
  mode: 'dev' | 'prod'
}

export function createRequestHandler(_options: RequestHandlerOptions) {
  return async () => new Response('Not implemented', { status: 501 })
}
