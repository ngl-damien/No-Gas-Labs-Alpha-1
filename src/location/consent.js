// NGL location policy: explicit consent, coarse by default, no automatic persistence.
export function normalizeFix(position, {precision = "coarse"} = {}) {
  if (!position || !Number.isFinite(position.coords?.latitude) || !Number.isFinite(position.coords?.longitude)) throw new Error("invalid location fix");
  const {latitude,longitude,accuracy}=position.coords;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) throw new Error("out of range");
  if (precision !== "coarse" && precision !== "precise") throw new Error("invalid precision");
  const digits = precision === "precise" ? 5 : 2;
  return Object.freeze({schema:"ngl.location.fix.v1",latitude:Number(latitude.toFixed(digits)),longitude:Number(longitude.toFixed(digits)),accuracy_m:Number.isFinite(accuracy)?Math.ceil(accuracy):null,precision,observed_at:new Date(position.timestamp || Date.now()).toISOString(),source:"device-geolocation",authority:"USER_CONSENT_REQUIRED",verified:false});
}
export function createLocationController(geolocation) {
  let active = null;
  return Object.freeze({
    async request({precision="coarse"}={}) {
      if (!geolocation?.getCurrentPosition) throw new Error("geolocation unavailable");
      if (active) throw new Error("location request already in progress");
      active = true;
      try {
        const position = await new Promise((resolve,reject)=>geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:precision==="precise",timeout:15000,maximumAge:0}));
        return normalizeFix(position,{precision});
      } finally { active=null; }
    }
  });
}
