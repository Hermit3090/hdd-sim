// Overlapping parameter loads (R8.14, R6.14): only the newest choice counts.
// A preset file from the server or a file chosen by hand arrives later; when
// the user has chosen something else in the meantime, its result is dropped.

export function createLoadGate() {
  let current = 0;
  return {
    /** A choice without a load (a built-in preset, a reset): loads on their way are obsolete. */
    invalidate() {
      current++;
    },
    /**
     * Starts a load as the newest choice. `onLoaded` gets its result and
     * `onFailed` its error (also an error thrown by `onLoaded`), both only if
     * no other choice came after it.
     * @param {() => Promise<any>|any} load
     * @param {(value: any) => void} onLoaded
     * @param {(err: Error) => void} onFailed
     * @returns {Promise<void>}
     */
    run(load, onLoaded, onFailed) {
      const id = ++current;
      const isCurrent = () => id === current;
      return Promise.resolve()
        .then(load)
        .then((value) => { if (isCurrent()) onLoaded(value); })
        .catch((err) => { if (isCurrent()) onFailed(err); });
    },
  };
}
