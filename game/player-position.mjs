const STORAGE_KEY='ngl.common-ground.player-position.v1';
const SCHEMA='ngl.player-position.v1';
const WORLD_WIDTH=1600,WORLD_HEIGHT=1000;
const POSITION_FIELDS=Object.freeze(['x','y']);

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
