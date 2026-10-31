// NGL location policy: explicit consent, coarse by default, no automatic persistence.
export function normalizeFix(position, options = {}) {
  const precision = options?.precision ?? "coarse";
  const coords = position?.coords;
  if (!Number.isFinite(coords?.latitude) || !Number.isFinite(coords?.longitude)) {
    throw new Error("invalid location fix");
  }

  const { latitude, longitude, accuracy } = coords;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error("out of range");
  }
  if (precision !== "coarse" && precision !== "precise") {
    throw new Error("invalid precision");
  }
  if (typeof accuracy === "number" && accuracy < 0) {
    throw new Error("invalid accuracy");
  }

  const timestamp = position.timestamp === undefined || position.timestamp === null
    ? Date.now()
    : position.timestamp;
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new Error("invalid location timestamp");
  }
  const observedAt = new Date(timestamp);
  if (!Number.isFinite(observedAt.getTime())) {
    throw new Error("invalid location timestamp");
  }

  const digits = precision === "precise" ? 5 : 2;
  const accuracyMeters = Number.isFinite(accuracy) ? Math.ceil(accuracy) : null;
  if (accuracyMeters !== null && !Number.isSafeInteger(accuracyMeters)) {
    throw new Error("invalid accuracy");
  }

  return Object.freeze({
    schema: "ngl.location.fix.v1",
    latitude: Number(latitude.toFixed(digits)),
    longitude: Number(longitude.toFixed(digits)),
    accuracy_m: accuracyMeters,
    precision,
    observed_at: observedAt.toISOString(),
    source: "device-geolocation",
    authority: "USER_CONSENT_REQUIRED",
    verified: false
  });
}

export function createLocationController(geolocation) {
  let active = null;
  return Object.freeze({
    async request({ precision = "coarse" } = {}) {
      if (!geolocation?.getCurrentPosition) throw new Error("geolocation unavailable");
      if (active) throw new Error("location request already in progress");
      active = true;
      try {
        const position = await new Promise((resolve, reject) =>
          geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: precision === "precise",
            timeout: 15000,
            maximumAge: 0
          })
        );
        return normalizeFix(position, { precision });
      } finally {
        active = null;
      }
    }
  });
}
