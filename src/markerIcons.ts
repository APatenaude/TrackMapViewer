import type { MarkerKind } from "./trackDoc.js";

export interface MarkerIcon {
	id: string;
	/** Layer the icon belongs to (sets its default marker kind). */
	kind: Exclude<MarkerKind, "corner" | "label">;
	label: { en: string; fr: string };
	/** Markup centred on (0,0), 1 unit = 0.1869 m; directional icons point +x. */
	svg: string;
}

const CYAN = "#00ffff";
const HALO = "#003b3b";
const ORANGE = "#ff6600";
const YELLOW = "#ffff00";
const STROKE = 6;
const ROUND = `stroke-linecap="round" stroke-linejoin="round"`;

const r1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * Cyan pictogram over a dark rim so it still reads on light pavement. `stroke` is outlined,
 * `fill` solid cyan, `cut` dark detail painted on top of the fill.
 */
function ref(stroke: string, fill = "", cut = ""): string {
	const halo =
		`<g opacity="0.6" fill="none" stroke="${HALO}" ${ROUND}>` +
		(stroke && `<path d="${stroke}" stroke-width="${STROKE + 4}"/>`) +
		(fill && `<path d="${fill}" fill="${HALO}" stroke-width="4"/>`) +
		`</g>`;
	return (
		halo +
		(stroke && `<path d="${stroke}" fill="none" stroke="${CYAN}" stroke-width="${STROKE}" ${ROUND}/>`) +
		(fill && `<path d="${fill}" fill="${CYAN}"/>`) +
		(cut && `<path d="${cut}" fill="${HALO}"/>`)
	);
}

/** Open arrowhead with its tip at (x, y), pointing along `angle` (radians). */
function head(x: number, y: number, angle: number, size = 9): string {
	const wing = (da: number): string => `${r1(x - Math.cos(angle + da) * size)} ${r1(y - Math.sin(angle + da) * size)}`;
	return `M ${wing(0.75)} L ${r1(x)} ${r1(y)} L ${wing(-0.75)}`;
}

function arrow(x1: number, y1: number, x2: number, y2: number, size = 9): string {
	return `M ${r1(x1)} ${r1(y1)} L ${r1(x2)} ${r1(y2)} ${head(x2, y2, Math.atan2(y2 - y1, x2 - x1), size)}`;
}

function circle(cx: number, cy: number, r: number): string {
	return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
}

/** Side view of a floor-hinged pedal; press/release push along the pad's normal, throttle lies flat. */
function pedalIcon(mode: "press" | "release" | "throttle"): string {
	const flat = mode === "throttle";
	const hx = -20;
	const hy = flat ? 17 : 14;
	const a = ((flat ? -5 : -28) * Math.PI) / 180;
	// s runs along the pad from the hinge, h away from its underside
	const at = (s: number, h: number): [number, number] => [
		hx + Math.cos(a) * s + Math.sin(a) * h,
		hy + Math.sin(a) * s - Math.cos(a) * h,
	];
	const pt = (s: number, h: number): string => at(s, h).map(r1).join(" ");
	const pad = `M ${pt(0, 0)} L ${pt(42, 0)} L ${pt(42, 9)} L ${pt(0, 9)} Z M ${hx - 4} 24 L ${hx} ${hy} L ${hx + 6} 24 Z`;
	const floor = "M -28 24 H 28";
	if (flat) return ref(`${floor} M -14 -26 L -2 -14 L -14 -2 M 4 -26 L 16 -14 L 4 -2`, pad);
	const [near, far] = [at(23, 14), at(23, 36)];
	return ref(`${floor} ${mode === "press" ? arrow(...far, ...near) : arrow(...near, ...far)}`, pad);
}

/** Leafy crown with a trunk, crown centred on (cx, cy). */
function tree(cx: number, cy: number, s: number): string {
	const x = (v: number): number => r1(cx + v * s);
	const y = (v: number): number => r1(cy + v * s);
	const r = (v: number): number => r1(v * s);
	return (
		`M ${x(-6)} ${y(10)} A ${r(7)} ${r(7)} 0 0 1 ${x(-10)} ${y(-2)} A ${r(10)} ${r(10)} 0 0 1 ${x(10)} ${y(-2)} ` +
		`A ${r(7)} ${r(7)} 0 0 1 ${x(6)} ${y(10)} Z M ${x(0)} ${y(10)} V ${y(22)}`
	);
}

function drop(cx: number, cy: number, s: number): string {
	const x = (v: number): number => r1(cx + v * s);
	const y = (v: number): number => r1(cy + v * s);
	const r = r1(9 * s);
	return (
		`M ${x(0)} ${y(-14)} C ${x(4)} ${y(-8)} ${x(9)} ${y(-3)} ${x(9)} ${y(3)} A ${r} ${r} 0 0 1 ${x(-9)} ${y(3)} ` +
		`C ${x(-9)} ${y(-3)} ${x(-4)} ${y(-8)} ${x(0)} ${y(-14)} Z`
	);
}

/** Letter P, stem at x, 40 tall centred on y = 0. */
function letterP(x: number): string {
	return `M ${x} 20 V -20 H ${x + 9} A 10 10 0 0 1 ${x + 9} 0 H ${x}`;
}

function checkers(x: number, y: number, cols: number, rows: number, size: number): string {
	let d = "";
	for (let row = 0; row < rows; row++)
		for (let col = (row + 1) % 2; col < cols; col += 2)
			d += `M ${x + col * size} ${y + row * size} h ${size} v ${size} h ${-size} Z `;
	return d.trim();
}

const SIGN = `fill="#fff" stroke="#000" stroke-width="3" stroke-linejoin="round"`;
const INK = `fill="none" stroke="#000" stroke-width="5" ${ROUND}`;
const YELLOW_SHAPE = `fill="${YELLOW}" stroke="#000" stroke-width="3" stroke-linejoin="round"`;

export const MARKER_ICONS: readonly MarkerIcon[] = [
	{
		id: "pedal-press",
		kind: "reference",
		label: { en: "Brake / press pedal", fr: "Freiner / appuyer" },
		svg: pedalIcon("press"),
	},
	{
		id: "pedal-release",
		kind: "reference",
		label: { en: "Release pedal", fr: "Relâcher la pédale" },
		svg: pedalIcon("release"),
	},
	{
		id: "throttle",
		kind: "reference",
		label: { en: "Throttle / full throttle", fr: "Plein gaz" },
		svg: pedalIcon("throttle"),
	},
	{
		id: "eye",
		kind: "reference",
		label: { en: "Look / vision", fr: "Regard" },
		svg: ref(
			`M -30 6 Q -8 -18 14 6 Q -8 30 -30 6 Z M -8 -16 Q 18 -30 30 -6 ${head(30, -6, Math.atan2(24, 12), 9)}`,
			circle(-8, 6, 6),
		),
	},
	{
		id: "steer",
		kind: "reference",
		label: { en: "Turn in / steering", fr: "Braquer" },
		svg: ref(`${circle(-10, 0, 19)} M -28 -4 L -10 0 L 8 -4 M -10 0 V 19 ${arrow(16, 0, 36, 0)}`, circle(-10, 0, 5)),
	},
	{
		id: "hand",
		kind: "reference",
		label: { en: "Point / hands", fr: "Mains" },
		svg: ref(
			"M -20 -10 L -6 -16 H 24 A 5 5 0 0 1 24 -6 H 4 A 4 4 0 0 1 4 2 A 4 4 0 0 1 3 10 A 4 4 0 0 1 1 18 H -10 Q -20 18 -20 10 Z M 4 2 H -2 M 3 10 H -2",
		),
	},
	{
		id: "speedometer",
		kind: "reference",
		label: { en: "Speed / carry speed", fr: "Vitesse" },
		svg: ref(`M -17.3 18 A 20 20 0 1 1 17.3 18 M 0 8 L 10 -5 ${arrow(-10, -26, 12, -26, 7)}`, circle(0, 8, 4.5)),
	},
	{
		id: "corner-sign",
		kind: "reference",
		label: { en: "Corner sign", fr: "Panneau de virage" },
		svg:
			`<path d="M -16 -26 H 16 V 26 H -16 Z" ${SIGN}/>` +
			`<path d="M -5 18 V 4 Q -5 -10 8 -15 ${head(8, -15, Math.atan2(-5, 13), 8)}" ${INK}/>`,
	},
	{
		id: "trees",
		kind: "reference",
		label: { en: "Trees / landmark", fr: "Arbres / repère" },
		svg: ref(`${tree(-12, -8, 1.3)} ${tree(17, 2, 0.95)}`),
	},
	{
		id: "curb",
		kind: "reference",
		label: { en: "Curb / rumble strip", fr: "Vibreur" },
		svg: ref("M -32 -10 H 32 V 10 H -32 Z", "M -24 10 L -14 -10 H -6 L -16 10 Z M 0 10 L 10 -10 H 18 L 8 10 Z"),
	},
	{
		id: "bridge",
		kind: "reference",
		label: { en: "Bridge / overpass", fr: "Pont / passerelle" },
		svg: ref("M -34 -14 H 34 V 20 H 22 Q 22 -2 0 -2 Q -22 -2 -22 20 H -34 Z"),
	},
	{
		id: "building",
		kind: "reference",
		label: { en: "Building / tower", fr: "Bâtiment / tour" },
		svg: ref(
			"M -32 26 H 32 M -22 26 V -24 H 4 V 26 M 4 -2 H 24 V 26",
			"M -15 -16 h 12 v 8 h -12 Z M -15 0 h 12 v 8 h -12 Z",
		),
	},
	{
		id: "tires",
		kind: "reference",
		label: { en: "Tire wall", fr: "Mur de pneus" },
		svg: ref(
			`${circle(-14, 11, 13)} ${circle(14, 11, 13)} ${circle(0, -13, 13)}`,
			`${circle(-14, 11, 4)} ${circle(14, 11, 4)} ${circle(0, -13, 4)}`,
		),
	},
	{
		id: "wall",
		kind: "reference",
		label: { en: "Wall / barrier", fr: "Mur / glissière" },
		svg: ref("M -32 -16 H 32 V 16 H -32 Z M -32 0 H 32 M -10 -16 V 0 M 14 -16 V 0 M 2 0 V 16 M -22 0 V 16 M 22 0 V 16"),
	},
	{
		id: "ref-line",
		kind: "reference",
		label: { en: "Reference line", fr: "Ligne de repère" },
		svg: ref("M -35 0 H 35"),
	},
	{
		id: "double-line",
		kind: "reference",
		label: { en: "Double reference line", fr: "Double ligne" },
		svg: ref("M -35 -8 H 35 M -35 8 H 35"),
	},
	{
		id: "cone",
		kind: "reference",
		label: { en: "Cone", fr: "Cône" },
		svg: ref("M -24 22 H 24", "M -14 20 L -5 -24 H 5 L 14 20 Z", "M -8.9 -6 H 8.9 L 10.6 2 H -10.6 Z"),
	},
	{
		id: "brake-board",
		kind: "reference",
		label: { en: "Brake board", fr: "Panneau de freinage" },
		svg:
			`<path d="M 0 8 V 28" ${INK}/>` +
			`<path d="M -16 -28 H 16 V 8 H -16 Z" ${SIGN}/>` +
			`<path d="M -7 -21 H 7 L 0 -12 A 7.5 7.5 0 1 1 -6.5 -0.8" ${INK}/>`,
	},
	{
		id: "hazard",
		kind: "reference",
		label: { en: "Caution", fr: "Attention" },
		svg:
			`<path d="M 0 -26 L 28 22 H -28 Z" fill="#ffd400" stroke="#000" stroke-width="4" stroke-linejoin="round"/>` +
			`<path d="M 0 -10 V 5" stroke="#000" stroke-width="6" stroke-linecap="round"/><circle cy="13.5" r="3.5" fill="#000"/>`,
	},
	{
		id: "avoid",
		kind: "reference",
		label: { en: "Stay off / avoid", fr: "À éviter" },
		svg: `<circle r="26" fill="#fff" stroke="#d40000" stroke-width="8"/><path d="M -18 -18 L 18 18" stroke="#d40000" stroke-width="8"/>`,
	},
	{
		id: "blind",
		kind: "reference",
		label: { en: "Blind spot / no view", fr: "Sans visibilité" },
		svg: ref("M -30 2 Q 0 -24 30 2 Q 0 28 -30 2 Z M -24 -24 L 24 28", circle(0, 2, 7)),
	},
	{
		id: "bump",
		kind: "reference",
		label: { en: "Bumps / rough pavement", fr: "Bosses / pavé abîmé" },
		svg: ref("M -34 14 H -24 Q -16 -14 -8 14 Q 0 -14 8 14 Q 16 -14 24 14 H 34"),
	},
	{
		id: "seam",
		kind: "reference",
		label: { en: "Pavement seam / patch", fr: "Joint de pavé" },
		svg: ref("M -32 -18 H 32 M -32 18 H 32 M -8 -18 L 5 -6 L -6 5 L 8 18"),
	},
	{
		id: "gravel",
		kind: "reference",
		label: { en: "Gravel trap / runoff", fr: "Bac de gravier" },
		svg: ref(
			"M -32 -18 H 32 V 18 H -32 Z",
			[-20, -7, 7, 20].flatMap((x, i) => [-7, 7].map((y) => circle(x, y + (i % 2 ? 2 : -2), 3.5))).join(" "),
		),
	},
	{
		id: "off-camber",
		kind: "reference",
		label: { en: "Off-camber", fr: "Dévers négatif" },
		svg: ref(`M -34 -2 L 34 20 ${circle(-4.3, -5, 12)} ${arrow(12, -16, 32, -9.5, 8)}`),
	},
	{
		id: "uphill",
		kind: "reference",
		label: { en: "Uphill", fr: "Montée" },
		svg: ref(`M -32 24 H 32 ${arrow(-28, 16, 26, -18)}`),
	},
	{
		id: "downhill",
		kind: "reference",
		label: { en: "Downhill", fr: "Descente" },
		svg: ref(`M -32 24 H 32 ${arrow(-26, -18, 28, 16)}`),
	},
	{
		id: "flag-station",
		kind: "reference",
		label: { en: "Flag station", fr: "Poste de signaleur" },
		svg: ref("M -18 30 V -26", "M -18 -28 C -6 -34 4 -22 20 -28 V -6 C 4 0 -6 -12 -18 -6 Z"),
	},
	{
		id: "start-finish",
		kind: "reference",
		label: { en: "Start / finish", fr: "Départ / arrivée" },
		svg: ref("M -24 30 V -28", "M -24 -28 H 24 V 8 H -24 Z", checkers(-24, -28, 4, 3, 12)),
	},
	{
		id: "shift",
		kind: "reference",
		label: { en: "Shift point", fr: "Changement de rapport" },
		svg: ref(
			"M -18 -16 V 16 M 0 -16 V 16 M 18 -16 V 16 M -18 0 H 18",
			[-18, 0, 18].map((x) => `${circle(x, -18, 5)} ${circle(x, 18, 5)}`).join(" "),
		),
	},
	{
		id: "pit-in",
		kind: "reference",
		label: { en: "Pit in", fr: "Entrée des stands" },
		svg: ref(`${arrow(-32, 0, -6, 0)} ${letterP(6)}`),
	},
	{
		id: "pit-out",
		kind: "reference",
		label: { en: "Pit out", fr: "Sortie des stands" },
		svg: ref(`${letterP(-26)} ${arrow(4, 0, 30, 0)}`),
	},
	{
		id: "wet",
		kind: "reference",
		label: { en: "Slippery / wet", fr: "Glissant" },
		svg: ref(`${drop(-10, -4, 1.3)} ${drop(16, 2, 0.85)} M -28 24 q 7 -6 14 0 t 14 0 t 14 0 t 14 0`),
	},
	{
		id: "target",
		kind: "reference",
		label: { en: "Look-ahead target", fr: "Point de visée" },
		svg: ref(`${circle(0, 0, 24)} ${circle(0, 0, 12)}`, circle(0, 0, 4)),
	},
	{
		id: "crest",
		kind: "crest",
		label: { en: "Crest / compression", fr: "Crête / compression" },
		svg:
			`<path d="M -38 22 Q 0 0 38 22" fill="none" stroke="${ORANGE}" stroke-width="6" stroke-linecap="round"/>` +
			`<path d="M -27 3 L -28 -3 Q -27 -6 -20 -7 L -13 -7 Q -7 -13 1 -13 Q 7 -13 13 -7 L 24 -5 Q 28 -4 28 0 L 28 3 Z" fill="${ORANGE}" stroke="${ORANGE}" stroke-width="2" stroke-linejoin="round"/>` +
			`<path d="M -11 -7 Q -6 -11 0 -11 Q 5 -11 9 -7 Z" fill="#fff"/>` +
			`<g fill="#222" stroke="#fff" stroke-width="1.5"><circle cx="-16" cy="4" r="6"/><circle cx="16" cy="4" r="6"/></g>`,
	},
	{
		id: "turn-in",
		kind: "apex",
		label: { en: "Turn-in point", fr: "Point de braquage" },
		svg: `<path d="M 28 0 L -12 -20 L -4 0 L -12 20 Z M -26 -24 H -18 V 24 H -26 Z" ${YELLOW_SHAPE}/>`,
	},
	{
		id: "apex",
		kind: "apex",
		label: { en: "Apex", fr: "Apex" },
		svg: `<path d="M 26 0 L -26 -24 L -16 0 L -26 24 Z" ${YELLOW_SHAPE}/>`,
	},
	{
		id: "track-out",
		kind: "apex",
		label: { en: "Track-out point", fr: "Point de sortie" },
		svg: `<path d="M 12 0 L -28 -20 L -20 0 L -28 20 Z M 18 -24 H 26 V 24 H 18 Z" ${YELLOW_SHAPE}/>`,
	},
	{
		id: "car",
		kind: "car",
		label: { en: "Car", fr: "Voiture" },
		svg:
			`<rect x="-21" y="-10" width="42" height="20" rx="6" fill="#000" stroke="#fff" stroke-width="1.5"/>` +
			`<path d="M 3 -7 L 10 -8.5 Q 11.5 0 10 8.5 L 3 7 Z M -10 -6.5 L -15 -7.5 Q -16 0 -15 7.5 L -10 6.5 Z" fill="#fff"/>`,
	},
];

const BY_ID = new Map(MARKER_ICONS.map((icon) => [icon.id, icon]));

export function markerIcon(id: string | undefined): MarkerIcon | undefined {
	return id === undefined ? undefined : BY_ID.get(id);
}
