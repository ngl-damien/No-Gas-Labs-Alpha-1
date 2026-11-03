import { WorldView, PLACES, WORLD_WIDTH, WORLD_HEIGHT } from './world-view.mjs';

export const WORLD_TILE_SIZE = 32;
const HALF_TILE = WORLD_TILE_SIZE / 2;
const PATHS = [
  [[85,730],[180,640],[325,675],[540,710],[690,720],[850,720],[1050,720],[1130,625],[1280,600],[1480,620]],
  [[325,675],[350,510],[430,425],[670,380],[850,360],[1025,360],[1160,320],[1310,350]],
  [[1050,720],[1120,820],[1280,850],[1440,820]],
  [[180,640],[150,450],[240,300],[480,260],[670,330]]
];

function riverX(y) {
  return 856 + Math.sin(y / 155) * 34;
}

function hash2(x, y) {
  let value = Math.imul(x | 0, 0x45d9f3b) ^ Math.imul(y | 0, 0x119de1f3);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

function distanceToSegment(x, y, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(x - start[0], y - start[1]);
  const amount = Math.max(0, Math.min(1,
    ((x - start[0]) * dx + (y - start[1]) * dy) / lengthSquared
  ));
  return Math.hypot(x - (start[0] + amount * dx), y - (start[1] + amount * dy));
}

function nearPath(x, y) {
  return PATHS.some(path => path.slice(1).some((point, index) =>
    distanceToSegment(x, y, path[index], point) <= 15
  ));
}

/** Deterministic terrain classification for the shared world coordinate grid. */
export function classifyWorldTile(tileX, tileY) {
  if (!Number.isInteger(tileX) || !Number.isInteger(tileY)) return 'void';
  const x = tileX * WORLD_TILE_SIZE + HALF_TILE;
  const y = tileY * WORLD_TILE_SIZE + HALF_TILE;
  if (x < 0 || y < 0 || x >= WORLD_WIDTH || y >= WORLD_HEIGHT) return 'void';

  if (Math.abs(x - riverX(y)) < 58) {
    return (y >= 326 && y <= 396) || (y >= 682 && y <= 754) ? 'bridge' : 'water';
  }
  if (Math.hypot(x - 1040, y - 440) < 74) return 'plaza';
  if (nearPath(x, y)) return 'path';
  if (Math.hypot(x - 1280, y - 810) < 88) return 'stone';
  return 'grass';
}

/** Stable tile descriptor; no world state or random source is consulted. */
export function worldTileAt(tileX, tileY) {
  return Object.freeze({
    x: tileX * WORLD_TILE_SIZE,
    y: tileY * WORLD_TILE_SIZE,
    kind: classifyWorldTile(tileX, tileY),
    variant: hash2(tileX, tileY) % 4
  });
}

export const PIXEL_SPRITES = Object.freeze({
  tree: Object.freeze([
    '....GGGG....',
    '...GGGGGG...',
    '..GGGGGGGG..',
    '.GGGLLGGGGG.',
    '.GGGGGGGGGG.',
    '..GGGGGGGG..',
    '...GGGGGG...',
    '....TTTT....',
    '....TTTT....',
    '....TTTT....'
  ]),
  rock: Object.freeze([
    '...SSSS...',
    '..SSSSSS..',
    '.SSLLLLSS.',
    'SSLLLLLLSS',
    '.SSSSSSSS.'
  ]),
  founder: Object.freeze([
    '...HHHH...',
    '..HHHHHH..',
    '..HFFFFH..',
    '..FFFFFF..',
    '...CCCC...',
    '..CCCCCC..',
    '..CCLLCC..',
    '...CCCC...',
    '...BBBB...',
    '..BB..BB..'
  ]),
  visitor: Object.freeze([
    '...GGGG...',
    '..GGGGGG..',
    '..GFFFFG..',
    '..FFFFFF..',
    '...VVVV...',
    '..VVVVVV..',
    '..VVLLVV..',
    '...VVVV...',
    '...BBBB...',
    '..BB..BB..'
  ]),
  moonshot: Object.freeze([
    '...CC...',
    '..CLLC..',
    '.CLLLLC.',
    'CLLLLLLC',
    '.CLLLLC.',
    '..CLLC..',
    '...CC...',
    '...TT...'
  ]),
  challenge: Object.freeze([
    '..RRRR..',
    '.RWWWWR.',
    'RWWWWWWR',
    'RWWWWWWR',
    '.RWWWWR.',
    '..RRRR..',
    '...TT...',
    '...TT...'
  ])
});

const TILE_COLORS = Object.freeze({
  void: ['#0c0d0b'],
  grass: ['#536b49','#58704c','#4f6746','#5c744e'],
  path: ['#aa9669','#b29c70','#a28e65','#b9a477'],
  water: ['#527f7d','#4e7978','#588784','#4a7475'],
  bridge: ['#806344','#896b48','#765b3f','#92734d'],
  plaza: ['#9a9a79','#a1a080','#929574','#a8a588'],
  stone: ['#777d69','#828572','#6e7664','#898a76']
});

const SPRITE_COLORS = Object.freeze({
  tree: Object.freeze({G:'#3e5b3e',L:'#77915c',T:'#71543b'}),
  rock: Object.freeze({S:'#656e60',L:'#b0b39a'}),
  founder: Object.freeze({H:'#bd713c',F:'#e4bd91',C:'#3c5e55',L:'#b7c4a1',B:'#343e39'}),
  visitor: Object.freeze({G:'#718765',F:'#e0bd96',V:'#718c77',L:'#b7c4a1',B:'#343e39'}),
  moonshot: Object.freeze({C:'#5f8873',L:'#c4d1a0',T:'#765d40'}),
  challenge: Object.freeze({R:'#a64f3b',W:'#e8e6dc',T:'#765d40'})
});

function drawSprite(context, rows, colors, x, bottom, pixelSize) {
  const width = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  const left = Math.round(x - width * pixelSize / 2);
  const top = Math.round(bottom - rows.length * pixelSize);
  rows.forEach((row, rowIndex) => {
    Array.from(row).forEach((symbol, columnIndex) => {
      const color = colors[symbol];
      if (!color) return;
      context.fillStyle = color;
      context.fillRect(
        left + columnIndex * pixelSize,
        top + rowIndex * pixelSize,
        pixelSize,
        pixelSize
      );
    });
  });
}

function drawTile(context, tile) {
  const x = tile.x;
  const y = tile.y;
  const colorSet = TILE_COLORS[tile.kind] || TILE_COLORS.void;
  context.fillStyle = colorSet[tile.variant % colorSet.length];
  context.fillRect(x, y, WORLD_TILE_SIZE, WORLD_TILE_SIZE);

  if (tile.kind === 'grass') {
    const seed = hash2(x / WORLD_TILE_SIZE, y / WORLD_TILE_SIZE);
    context.fillStyle = tile.variant % 2 ? '#71865a' : '#6b8055';
    context.fillRect(x + 4 + seed % 19, y + 5 + (seed >>> 5) % 18, 3, 2);
    context.fillRect(x + 7 + (seed >>> 9) % 17, y + 8 + (seed >>> 13) % 16, 2, 3);
  } else if (tile.kind === 'path') {
    context.fillStyle = '#d0bb8b';
    context.fillRect(x + 4 + tile.variant * 2, y + 6, 8, 5);
    context.fillRect(x + 17, y + 19 + tile.variant, 9, 5);
    context.fillStyle = '#887957';
    context.fillRect(x + 5 + tile.variant * 2, y + 11, 7, 1);
  } else if (tile.kind === 'water') {
    context.fillStyle = '#86aa9b';
    context.fillRect(x + 4, y + 7 + tile.variant * 3, 11, 2);
    context.fillRect(x + 17, y + 21 - tile.variant * 2, 10, 2);
    context.fillStyle = '#3f6d70';
    context.fillRect(x + 10, y + 15, 5, 1);
  } else if (tile.kind === 'bridge') {
    context.fillStyle = '#b08a5b';
    for (let plank = 0; plank < 4; plank++) {
      context.fillRect(x + 3 + plank * 7, y + 2, 4, 28);
    }
    context.fillStyle = '#5d4b36';
    context.fillRect(x + 1, y + 2, 2, 28);
    context.fillRect(x + 29, y + 2, 2, 28);
  } else if (tile.kind === 'plaza') {
    context.fillStyle = '#b9b28d';
    context.fillRect(x + 2, y + 2, 13, 2);
    context.fillRect(x + 17, y + 17, 13, 2);
    context.fillStyle = '#7f866e';
    context.fillRect(x + 15, y + 3, 1, 26);
    context.fillRect(x + 3, y + 15, 26, 1);
  } else if (tile.kind === 'stone') {
    context.fillStyle = '#a4a58e';
    context.fillRect(x + 4, y + 7, 10, 7);
    context.fillRect(x + 17, y + 19, 11, 6);
    context.fillStyle = '#5f685d';
    context.fillRect(x + 5, y + 14, 8, 1);
  }
  context.fillStyle = '#25372c18';
  context.fillRect(x, y, WORLD_TILE_SIZE, 1);
  context.fillRect(x, y, 1, WORLD_TILE_SIZE);
}

function drawPixelBuilding(context, x, y, roof, wall, trim) {
  context.fillStyle = '#25372e66';
  context.fillRect(x - 42, y - 2, 84, 14);
  context.fillStyle = '#354638';
  context.fillRect(x - 40, y - 58, 80, 62);
  context.fillStyle = trim;
  context.fillRect(x - 38, y - 58, 76, 42);
  context.fillStyle = roof;
  context.fillRect(x - 34, y - 54, 68, 34);
  for (let seam = 0; seam < 4; seam++) {
    context.fillStyle = '#24362d55';
    context.fillRect(x - 30, y - 50 + seam * 8, 60, 2);
  }
  context.fillStyle = wall;
  context.fillRect(x - 32, y - 20, 64, 24);
  context.fillStyle = '#2d3c31';
  context.fillRect(x - 8, y - 20, 16, 24);
  context.fillStyle = '#c2c9a4';
  context.fillRect(x - 27, y - 14, 10, 8);
  context.fillRect(x + 17, y - 14, 10, 8);
  context.fillStyle = '#657b5e';
  context.fillRect(x - 25, y - 12, 6, 4);
  context.fillRect(x + 19, y - 12, 6, 4);
}

const DECORATIONS = Array.from({ length: 48 }, (_, index) => ({
  x: 48 + hash2(index + 11, 17) % 1504,
  y: 48 + hash2(index + 73, 29) % 904,
  type: index % 8 === 0 ? 'rock' : 'tree'
})).filter(item =>
  classifyWorldTile(Math.floor(item.x / WORLD_TILE_SIZE), Math.floor(item.y / WORLD_TILE_SIZE)) === 'grass' &&
  PLACES.every(place => Math.hypot(place.x - item.x, place.y - item.y) > 92)
);

export class PixelWorldView extends WorldView {
  constructor(canvas, options = {}) {
    super(canvas, options);
    canvas.dataset.worldRenderer = 'pixel-v1';
    canvas.style.imageRendering = 'pixelated';
    canvas.setAttribute('aria-label', 'No Gas Labs top-down pixel-art world');
  }

  text(value, x, y, size = 13, color = '#29443d', font = 'ui-monospace, monospace') {
    const context = this.ctx;
    context.font = size + 'px ' + font;
    context.fillStyle = color;
    context.textAlign = 'center';
    context.fillText(String(value), x, y);
  }

  drawLandscape() {
    const context = this.ctx;
    const halfWidth = this.width / (2 * this.zoom);
    const halfHeight = this.height / (2 * this.zoom);
    const firstColumn = Math.max(0, Math.floor((this.camera.x - halfWidth) / WORLD_TILE_SIZE) - 1);
    const lastColumn = Math.min(Math.ceil(WORLD_WIDTH / WORLD_TILE_SIZE),
      Math.ceil((this.camera.x + halfWidth) / WORLD_TILE_SIZE) + 1);
    const firstRow = Math.max(0, Math.floor((this.camera.y - halfHeight) / WORLD_TILE_SIZE) - 1);
    const lastRow = Math.min(Math.ceil(WORLD_HEIGHT / WORLD_TILE_SIZE),
      Math.ceil((this.camera.y + halfHeight) / WORLD_TILE_SIZE) + 1);

    for (let row = firstRow; row < lastRow; row++) {
      for (let column = firstColumn; column < lastColumn; column++) {
        drawTile(context, worldTileAt(column, row));
      }
    }

    for (const item of DECORATIONS) {
      if (item.type === 'rock') {
        drawSprite(context, PIXEL_SPRITES.rock, SPRITE_COLORS.rock, item.x, item.y, 4);
      } else {
        drawSprite(context, PIXEL_SPRITES.tree, SPRITE_COLORS.tree, item.x, item.y, 4);
      }
    }

    this.text('COMMON GROUND', 460, 100, 20, '#e8e6dc');
    this.text('A WALKABLE INSTITUTION', 460, 120, 9, '#d4d8c2');
    this.text('N', 1490, 80, 10, '#e8e6dc');
    context.fillStyle = '#e8e6dc';
    context.fillRect(1487, 88, 6, 20);
    context.fillRect(1480, 94, 20, 6);
  }

  drawTownSquare() {
    const context = this.ctx;
    const stalls = [
      { x: 995, color: '#a95d43' },
      { x: 1040, color: '#6f855e' },
      { x: 1085, color: '#496c68' }
    ];
    for (const stall of stalls) {
      context.fillStyle = '#26382e66';
      context.fillRect(stall.x - 19, 448, 38, 8);
      context.fillStyle = '#354638';
      context.fillRect(stall.x - 18, 414, 36, 34);
      context.fillStyle = stall.color;
      context.fillRect(stall.x - 20, 410, 40, 9);
      context.fillStyle = '#d8d1ad';
      context.fillRect(stall.x - 14, 424, 28, 3);
    }
    this.text('TOWNSQUARE', 1040, 468, 11, '#273b30');
    this.text((this.institutionCounts['town-square'] || 0) + ' retained records', 1040, 480, 8, '#445c49');
  }

  drawInstitution(place) {
    if (place.id === 'town-square') {
      this.drawTownSquare();
      return;
    }
    const roofColors = {
      guild_hall: '#506f54',
      forge: '#a45e3d',
      evidence_archive: '#6f825e',
      decision_chamber: '#3e5b50',
      academy: '#84916d',
      moonshot_field: '#526d60',
      publication_house: '#a85f42'
    };
    const roof = roofColors[place.id] || '#536d53';
    drawPixelBuilding(this.ctx, place.x, place.y + 8, roof, '#c6c7a5', '#344638');
    this.text(place.glyph || 'I', place.x, place.y - 28, 13, '#e8e6dc');
    this.text(place.name.toUpperCase(), place.x, place.y + 34, 8, '#293c30');
    this.text((this.institutionCounts[place.id] || 0) + ' records', place.x, place.y + 46, 7, '#445b49');
  }

  drawPlace(place) {
    const context = this.ctx;
    const { x, y, id } = place;
    context.fillStyle = '#26382e55';
    context.fillRect(x - 25, y + 20, 50, 7);

    if (id === 'relay') {
      context.fillStyle = '#69553b';
      context.fillRect(x - 3, y - 60, 6, 82);
      context.fillRect(x - 28, y - 48, 30, 6);
      context.fillStyle = '#b65f40';
      context.fillRect(x + 2, y - 58, 24, 15);
      context.fillStyle = '#e8e6dc';
      context.fillRect(x + 4, y - 55, 17, 2);
      context.fillRect(x + 4, y - 50, 12, 2);
    } else if (id === 'river') {
      context.fillStyle = '#3d5140';
      context.fillRect(x - 23, y - 42, 46, 40);
      context.fillStyle = '#c7bc91';
      context.fillRect(x - 19, y - 38, 38, 31);
      context.fillStyle = '#a75d40';
      context.fillRect(x - 23, y - 45, 46, 7);
      context.fillStyle = '#5b7357';
      context.fillRect(x - 12, y - 29, 24, 3);
      context.fillRect(x - 12, y - 21, 18, 3);
    } else if (id === 'overlook') {
      context.fillStyle = '#4c5e4c';
      context.fillRect(x - 28, y - 32, 56, 34);
      context.fillStyle = '#9e956f';
      context.fillRect(x - 23, y - 27, 46, 24);
      context.fillStyle = '#5e6f55';
      context.fillRect(x - 4, y - 58, 8, 30);
      context.fillRect(x - 20, y - 58, 40, 7);
      context.fillStyle = '#c3c79f';
      context.fillRect(x - 17, y - 48, 34, 4);
    } else {
      for (const offset of [-24, 0, 24]) {
        context.fillStyle = '#586452';
        context.fillRect(x + offset - 7, y - 35, 14, 45);
        context.fillStyle = '#a8aa91';
        context.fillRect(x + offset - 5, y - 31, 10, 37);
        context.fillStyle = '#65715c';
        context.fillRect(x + offset - 9, y + 5, 18, 5);
      }
    }
    this.text(place.name.toUpperCase(), x, y + 43, 8, '#293c30');
  }

  drawWorkbench() {
    const context = this.ctx;
    const x = 325, y = 645;
    context.fillStyle = '#29392e';
    context.fillRect(x - 34, y - 15, 68, 24);
    context.fillStyle = '#b79a68';
    context.fillRect(x - 37, y - 20, 74, 8);
    context.fillStyle = '#66513a';
    context.fillRect(x - 28, y + 4, 7, 22);
    context.fillRect(x + 21, y + 4, 7, 22);
    context.fillStyle = '#e8e6dc';
    context.fillRect(x - 13, y - 17, 20, 12);
    context.fillStyle = '#a95f3e';
    context.fillRect(x + 18, y - 28, 5, 18);
    context.fillRect(x + 13, y - 28, 15, 5);
    this.text('THE MAKING BENCH', x, y + 48, 9, '#293c30');
  }

  drawBuilding(creation) {
    if (!creation?.position || !Number.isFinite(creation.position.x) || !Number.isFinite(creation.position.y)) return;
    const colors = {
      comic: '#a85b43',
      loom: '#496f65',
      observatory: '#7a865c',
      custom: '#66746b'
    };
    const x = creation.position.x, y = creation.position.y;
    drawPixelBuilding(this.ctx, x, y + 8, colors[creation.kind] || '#596d5a', '#c9c7a5', '#354538');
    const title = Array.from(String(creation.title || 'Untitled'));
    this.text(title.length > 20 ? title.slice(0, 19).join('') + '…' : title.join(''), x, y + 34, 8, '#293c30');
    this.text(String(creation.kind || 'artifact').toUpperCase() + ' · v' + creation.version, x, y + 46, 7, '#445b49');
  }

  drawMoonshotObject(object) {
    drawSprite(this.ctx, PIXEL_SPRITES.moonshot, SPRITE_COLORS.moonshot, object.x, object.y + 12, 4);
    this.text(String(object.title || 'MOONSHOT').slice(0, 16), object.x, object.y + 27, 7, '#e8e6dc');
    this.text('R' + object.attemptCount + ' · C' + object.challengeCount, object.x, object.y + 38, 7, '#e8e6dc');
  }

  drawResearchActivityObject(object) {
    const challenge = object.recordType === 'experiment-challenged';
    const sprite = challenge ? PIXEL_SPRITES.challenge : PIXEL_SPRITES.moonshot;
    const colors = challenge ? SPRITE_COLORS.challenge : SPRITE_COLORS.moonshot;
    drawSprite(this.ctx, sprite, colors, object.x, object.y + 8, 3);
    this.text(String(object.title || 'RESEARCH').slice(0, 14), object.x, object.y + 20, 7, '#e8e6dc');
  }

  drawPlayer(player, other = false) {
    const bob = !this.reduced && this.moving && !other ? Math.round(Math.sin(this.time * 16)) : 0;
    const sprite = other ? PIXEL_SPRITES.visitor : PIXEL_SPRITES.founder;
    const colors = other ? SPRITE_COLORS.visitor : SPRITE_COLORS.founder;
    drawSprite(this.ctx, sprite, colors, player.x, player.y + bob, 4);
    if (!other) this.text('YOU', player.x, player.y + 25, 8, '#e8e6dc');
    else if (player.name) this.text(String(player.name).slice(0, 24), player.x, player.y + 25, 8, '#e8e6dc');
  }

  render() {
    const context = this.ctx;
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    context.imageSmoothingEnabled = false;
    context.save();
    context.translate(this.width / 2 - this.camera.x * this.zoom,
      this.height / 2 - this.camera.y * this.zoom);
    context.scale(this.zoom, this.zoom);

    this.drawLandscape();
    if (this.route.length) {
      context.fillStyle = '#c77b48';
      for (const point of this.route) context.fillRect(point.x - 3, point.y - 3, 6, 6);
    }

    const objects = [
      ...PLACES.filter(place => place.type === 'discovery').map(place => ({
        y: place.y, draw: () => this.drawPlace(place)
      })),
      ...PLACES.filter(place => place.type === 'institution').map(place => ({
        y: place.y, draw: () => this.drawInstitution(place)
      })),
      { y: 645, draw: () => this.drawWorkbench() },
      ...(this.world.creations || []).map(creation => ({
        y: creation?.position?.y ?? 0, draw: () => this.drawBuilding(creation)
      })),
      ...this.researchObjects.map(object => ({
        y: object.y, draw: () => this.drawMoonshotObject(object)
      })),
      ...this.researchActivityObjects.filter(object => object.mapVisible).map(object => ({
        y: object.y, draw: () => this.drawResearchActivityObject(object)
      })),
      ...this.presence.filter(player => player.id !== this.player.id &&
        Number.isFinite(player.x) && Number.isFinite(player.y)).map(player => ({
          y: player.y, draw: () => this.drawPlayer(player, true)
        })),
      { y: this.player.y, draw: () => this.drawPlayer(this.player) }
    ];
    objects.sort((left, right) => left.y - right.y).forEach(object => object.draw());

    const near = this.nearest();
    if (near?.distance < 145 && !document.body.classList.contains('modal-open')) {
      const label = near.type === 'workbench' ? 'E · Make something'
        : near.type === 'creation' ? 'E · Enter creation'
        : near.type === 'research-activity' ? 'E · Inspect research record'
        : near.type === 'research-object' ? 'E · Inspect moonshot'
        : 'E · Discover';
      const x = this.player.x, y = this.player.y - 70;
      context.font = '11px ui-monospace, monospace';
      const width = context.measureText(label).width + 18;
      context.fillStyle = '#e8e6dfee';
      context.fillRect(x - width / 2, y - 12, width, 22);
      context.fillStyle = '#293c30';
      context.fillRect(x - width / 2, y - 12, width, 2);
      this.text(label, x, y + 3, 10, '#293c30');
    }
    context.restore();
  }
}
