/**
 * The pagination argument every TanStack-family infinite hook takes, shared by the per-library
 * fixtures. `initialPageParam: 0` is what binds the hook's `TPageParam` to `number`.
 */
export const pagination = {
  initialPageParam: 0,
  getNextPageParam: (lastPage: { readonly nextPage?: number }) => lastPage.nextPage ?? null,
  buildInit: (pageParam: unknown) => ({ query: { page: String(pageParam) } }),
}
