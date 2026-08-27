/**
 * Workspace icon registry — Phosphor Icons (Regular weight)
 * Icons are imported as URL strings via Vite's default static asset handling.
 * Stored in config as icon ID string (e.g. "brain", "rocket").
 */

// AI / Agent
import robot from './robot.svg';
import brain from './brain.svg';
import sparkle from './sparkle.svg';
import lightning from './lightning.svg';
import atom from './atom.svg';
import cpu from './cpu.svg';
import detective from './detective.svg';
import gavel from './gavel.svg';
import contract from './contract.svg';

// Animals
import cat from './cat.svg';
import dog from './dog.svg';
import bird from './bird.svg';
import butterfly from './butterfly.svg';
import fish from './fish.svg';
import pawPrint from './paw-print.svg';
import bug from './bug.svg';
import bugBeetle from './bug-beetle.svg';

// Celestial
import sun from './sun.svg';
import moonStars from './moon-stars.svg';
import star from './star.svg';
import planet from './planet.svg';
import globe from './globe.svg';
import cloud from './cloud.svg';
import rainbow from './rainbow.svg';
import meteor from './meteor.svg';

// Objects / Tools
import lightbulb from './lightbulb.svg';
import rocket from './rocket.svg';
import compass from './compass.svg';
import palette from './palette.svg';
import musicNote from './music-note.svg';
import guitar from './guitar.svg';
import camera from './camera.svg';
import headphones from './headphones.svg';

// Nature / Plants
import flowerLotus from './flower-lotus.svg';
import leaf from './leaf.svg';
import plant from './plant.svg';
import tree from './tree.svg';
import mountains from './mountains.svg';
import fire from './fire.svg';
import umbrella from './umbrella.svg';

// Symbols / Fun
import heart from './heart.svg';
import crown from './crown.svg';
import diamond from './diamond.svg';
import trophy from './trophy.svg';
import gift from './gift.svg';
import balloon from './balloon.svg';
import ghost from './ghost.svg';
import alien from './alien.svg';
import gameController from './game-controller.svg';
import puzzlePiece from './puzzle-piece.svg';

// Default
import folderOpen from './folder-open.svg';
import cube from './cube.svg';

/** Icon ID → imported asset URL */
const ICON_MAP: Record<string, string> = {
    robot, brain, sparkle, lightning, atom, cpu, detective, gavel, contract,
    cat, dog, bird, butterfly, fish, 'paw-print': pawPrint, bug, 'bug-beetle': bugBeetle,
    sun, 'moon-stars': moonStars, star, planet, globe, cloud, rainbow, meteor,
    lightbulb, rocket, compass, palette, 'music-note': musicNote, guitar, camera, headphones,
    'flower-lotus': flowerLotus, leaf, plant, tree, mountains, fire, umbrella,
    heart, crown, diamond, trophy, gift, balloon, ghost, alien, 'game-controller': gameController, 'puzzle-piece': puzzlePiece,
    'folder-open': folderOpen,
    cube,
};

/** All available icon IDs grouped by category */
export const WORKSPACE_ICON_CATEGORIES = [
    { label: 'AI / Agent', icons: ['robot', 'brain', 'sparkle', 'lightning', 'atom', 'cpu', 'detective'] },
    { label: '法务', icons: ['detective', 'folder-open'] },
    { label: '动物', icons: ['cat', 'dog', 'bird', 'butterfly', 'fish', 'paw-print', 'bug', 'bug-beetle'] },
    { label: '天体', icons: ['sun', 'moon-stars', 'star', 'planet', 'globe', 'cloud', 'rainbow', 'meteor'] },
    { label: '物品', icons: ['lightbulb', 'rocket', 'compass', 'palette', 'music-note', 'guitar', 'camera', 'headphones'] },
    { label: '自然', icons: ['flower-lotus', 'leaf', 'plant', 'tree', 'mountains', 'fire', 'umbrella'] },
    { label: '符号', icons: ['heart', 'crown', 'diamond', 'trophy', 'gift', 'balloon', 'ghost', 'alien', 'game-controller', 'puzzle-piece'] },
];

/** Default icon for workspaces without a custom icon */
export const DEFAULT_WORKSPACE_ICON = 'cube';

/** Get the asset URL for a workspace icon ID. Returns undefined for unknown IDs. */
export function getWorkspaceIconUrl(iconId: string): string | undefined {
    return ICON_MAP[iconId];
}

/** All icon IDs (flat list) */
export const ALL_WORKSPACE_ICON_IDS = Object.keys(ICON_MAP);
