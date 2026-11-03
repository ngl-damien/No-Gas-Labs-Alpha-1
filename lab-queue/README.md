# lab-queue

Offline queue drop path for unified prototype (`one-prototype-*.json`).

Importer must be **read-only** w.r.t. canonical authority — parse queue files, never mutate `docs/authority/` or sealed Chronicle heads from queue alone.
