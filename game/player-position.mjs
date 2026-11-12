const STORAGE_KEY='ngl.common-ground.player-position.v1';
const SCHEMA='ngl.player-position.v1';
const WORLD_WIDTH=1600,WORLD_HEIGHT=1000;
const POSITION_FIELDS=Object.freeze(['x','y']);
const SUPERSEDED_POSITION_WRITE=Object.freeze({superseded:true});

/**
 * Only the server's exact optimistic-concurrency response is recoverable by
 * reconciling session position. Other 409s, durability failures, movement
 * validation errors and timeouts remain failures.
 */
export function isPositionRevisionConflict(error) {
  if (!error || typeof error !== 'object') return false;
  try {
    const status = Object.getOwnPropertyDescriptor(error, 'status');
    const code = Object.getOwnPropertyDescriptor(error, 'code');
    return Boolean(
      status && Object.hasOwn(status, 'value') && status.value === 409 &&
      code && Object.hasOwn(code, 'value') && code.value === 'POSITION_REVISION_CONFLICT'
    );
  } catch {
    return false;
  }
}

/**
 * Bound one shared-position transport attempt. Aborting a request does not prove
 * the server did not commit it; the server-issued position epoch/revision fences
 * late arrivals, and the caller must reconcile before sending another coordinate.
 */
export function createPositionWriteDeadline(write, {
  timeoutMs = 10_000,
  createAbortController = () => new AbortController(),
  schedule = setTimeout,
  cancel = clearTimeout
} = {}) {
  if (typeof write !== 'function') throw new TypeError('Position transport must be a function.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('Position write deadline must be a positive safe integer.');
  if (typeof createAbortController !== 'function' || typeof schedule !== 'function' || typeof cancel !== 'function') {
    throw new TypeError('Position write deadline controls must be functions.');
  }

  return async position => {
    const controller = createAbortController();
    if (!controller || typeof controller.abort !== 'function' || !controller.signal) {
      throw new TypeError('Position write deadline requires an AbortController.');
    }
    let timer;
    let scheduled = false;
    const deadline = new Promise((_, reject) => {
      timer = schedule(() => {
        try { controller.abort(); } catch {}
        reject(Object.assign(
          new Error('Position write deadline elapsed; reconcile server state before continuing.'),
          { code: 'POSITION_WRITE_TIMEOUT' }
        ));
      }, timeoutMs);
      scheduled = true;
    });

    try {
      return await Promise.race([
        Promise.resolve().then(() => write(position, { signal: controller.signal })),
        deadline
      ]);
    } finally {
      if (scheduled) cancel(timer);
    }
  };
}

function positionCoordinates(value,allowPlayerId=false){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  let prototype,descriptors;
  try{
    prototype=Object.getPrototypeOf(value);
    descriptors=Object.getOwnPropertyDescriptors(value);
  }catch{return null;}
  if(prototype!==Object.prototype&&prototype!==null)return null;
  const keys=Reflect.ownKeys(descriptors);
  const allowedKeys=allowPlayerId?[...POSITION_FIELDS,'id']:POSITION_FIELDS;
  if(keys.length<POSITION_FIELDS.length||keys.length>allowedKeys.length||
    keys.some(key=>typeof key!=='string'||!allowedKeys.includes(key)))return null;
  const coordinates=Object.create(null);
  for(const key of POSITION_FIELDS){
    const descriptor=descriptors[key];
    if(!descriptor||!Object.hasOwn(descriptor,'value')||!descriptor.enumerable)return null;
    coordinates[key]=descriptor.value;
  }
  if(Object.hasOwn(descriptors,'id')){
    const descriptor=descriptors.id;
    if(!allowPlayerId||!descriptor||!Object.hasOwn(descriptor,'value')||
      !descriptor.enumerable||typeof descriptor.value!=='string'||
      Array.from(descriptor.value).length>80)return null;
  }
  const {x,y}=coordinates;
  if(!Number.isFinite(x)||!Number.isFinite(y)||
    x<0||x>WORLD_WIDTH||y<0||y>WORLD_HEIGHT)return null;
  return Object.freeze({x,y});
}

/** Read the private character's last known map position; malformed storage fails closed. */
export function readPrivatePlayerPosition(storage){
  try{
    const target=storage??globalThis.localStorage;
    const raw=target.getItem(STORAGE_KEY);
    if(typeof raw!=='string'||raw.length>256)return null;
    const saved=JSON.parse(raw);
    if(!saved||typeof saved!=='object'||Array.isArray(saved))return null;
    const keys=Reflect.ownKeys(saved);
    if(keys.length!==3||keys.some(key=>!['schema','x','y'].includes(key)))return null;
    if(!Object.hasOwn(saved,'schema')||saved.schema!==SCHEMA)return null;
    return positionCoordinates({x:saved.x,y:saved.y});
  }catch{return null;}
}

/** Persist only bounded coordinates; an in-memory player ID is ignored, never persisted. */
export function writePrivatePlayerPosition(position,storage){
  try{
    const coordinates=positionCoordinates(position,true);
    if(!coordinates)return false;
    const target=storage??globalThis.localStorage;
    target.setItem(STORAGE_KEY,JSON.stringify({schema:SCHEMA,...coordinates}));
    return true;
  }catch{return false;}
}


/**
 * Serialize shared-world position writes while retaining at most one pending
 * coordinate. Intermediate updates are replaceable state snapshots, not events,
 * so a slow request keeps only the newest pending position instead of building
 * an unbounded backlog. Accepted writes remain ordered. This is transport
 * coordination only: it creates no world event, XP, evidence, or authority.
 */
export function createOrderedPositionWriter(write) {
  if (typeof write !== 'function') throw new TypeError('Position writer must be a function.');
  const pending = [];
  const idleWaiters = [];
  let draining = false;

  function resolveIdleWaiters() {
    if (draining || pending.length) return;
    for (const resolve of idleWaiters.splice(0)) resolve();
  }

  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (pending.length) {
        const current = pending.shift();
        try {
          current.resolve(await write(current.position));
        } catch (error) {
          current.reject(error);
          // Once the accepted-position stream fails, queued coordinates are
          // stale. Reject them together; the caller must read server state
          // before emitting another position.
          for (const queued of pending.splice(0)) queued.reject(error);
          break;
        }
      }
    } finally {
      draining = false;
      if (pending.length) void drain();
      else resolveIdleWaiters();
    }
  }

  const enqueue = function(position) {
    const coordinates = positionCoordinates(position, true);
    if (!coordinates) {
      return Promise.reject(new TypeError('Position must contain finite bounded own coordinates.'));
    }
    return new Promise((resolve, reject) => {
      // A position is the latest known state, not an append-only action. If a
      // request is still in flight, supersede the older queued snapshot rather
      // than retaining an unbounded backlog during slow or stalled connectivity.
      for (const queued of pending.splice(0)) queued.resolve(SUPERSEDED_POSITION_WRITE);
      pending.push({ position: coordinates, resolve, reject });
      void drain();
    });
  };

  enqueue.cancelPending = () => {
    const cancelled = pending.splice(0);
    for (const queued of cancelled) queued.resolve(SUPERSEDED_POSITION_WRITE);
    resolveIdleWaiters();
    return cancelled.length;
  };

  enqueue.whenIdle = () => {
    if (!draining && pending.length === 0) return Promise.resolve();
    return new Promise(resolve => idleWaiters.push(resolve));
  };

  return enqueue;
}

/**
 * A server position is a session-scoped projection, not a movement event.
 * A new presence identity must take its own authoritative position even while
 * the previous actor was moving; stale same-epoch snapshots still fail closed.
 */
export function shouldApplyServerPosition({
  previousSessionId,
  nextSessionId,
  staleSnapshot = false,
  forcePosition = false,
  moving = false,
  routeActive = false
} = {}) {
  if (staleSnapshot === true) return false;
  const hasPreviousSession = typeof previousSessionId === 'string' && previousSessionId.length > 0;
  const hasNextSession = typeof nextSessionId === 'string' && nextSessionId.length > 0;
  const sessionChanged = hasPreviousSession && hasNextSession &&
    previousSessionId !== nextSessionId;
  return sessionChanged || forcePosition === true || (moving !== true && routeActive !== true);
}
