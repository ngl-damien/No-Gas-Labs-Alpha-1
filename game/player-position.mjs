const STORAGE_KEY='ngl.common-ground.player-position.v1';
const SCHEMA='ngl.player-position.v1';
const WORLD_WIDTH=1600,WORLD_HEIGHT=1000;

function validPosition(value){
  return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
    Number.isFinite(value.x)&&Number.isFinite(value.y)&&
    value.x>=0&&value.x<=WORLD_WIDTH&&value.y>=0&&value.y<=WORLD_HEIGHT;
}

/** Read the private character's last known map position; malformed storage fails closed. */
export function readPrivatePlayerPosition(storage){
  try{
    const target=storage??globalThis.localStorage;
    const raw=target.getItem(STORAGE_KEY);
    if(typeof raw!=='string'||raw.length>256)return null;
    const saved=JSON.parse(raw);
    if(saved?.schema!==SCHEMA||!validPosition(saved))return null;
    return Object.freeze({x:saved.x,y:saved.y});
  }catch{return null;}
}

/** Persist only bounded coordinates, never identity, authority, XP or world state. */
export function writePrivatePlayerPosition(position,storage){
  try{
    if(!validPosition(position))return false;
    const target=storage??globalThis.localStorage;
    target.setItem(STORAGE_KEY,JSON.stringify({schema:SCHEMA,x:position.x,y:position.y}));
    return true;
  }catch{return false;}
}
