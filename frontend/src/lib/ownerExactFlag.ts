/**
 * When true, list APIs send ownerExact=1 so linked/act-as manager chips
 * filter to that person only (not their expanded team).
 * Set by useScopeQueryParams; read when building ownerIds query strings.
 */
let _ownerExact = false;

export const ownerExactFlag = {
  set(v: boolean): void {
    _ownerExact = v;
  },
  get(): boolean {
    return _ownerExact;
  },
};
