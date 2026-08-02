import type { PathSampler } from "./replayPath.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// Car geometry in image-pixel units (overlay viewBox ~4500 x 8192). Tweakable.
const CAR_LENGTH = 140;
const CAR_WIDTH = 62;
// Uniform on-map size multiplier (scales the whole car; keeps proportions).
const CAR_SCALE = 0.3;
const HALF_LEN = CAR_LENGTH / 2; // nose tip sits at +x
const HALF_WID = CAR_WIDTH / 2;

const BODY_FILL = "#ffd400";
const OUTLINE = "#1a1a1a";
const OUTLINE_W = 5;
const GLASS_FILL = "#22303a";
const WHEEL_FILL = "#141414";
const HELMET_FILL = "#eceff1";

function shape(tag: string, attrs: Record<string, string | number>): SVGElement {
	const el = document.createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs)) {
		el.setAttribute(k, String(v));
	}
	return el;
}

/**
 * A small top-down car as an SVG <g>, drawn centered at the origin and pointing
 * along +x, sized in image-pixel space, so `translate(x y) rotate(deg)` places
 * and aims it cleanly. Appended under the overlay svg (rotates with the map).
 */
export function createCarElement(): SVGGElement {
	const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
	g.setAttribute("class", "replay-car");

	// Wheels (dark, peek out past the body sides). Drawn first so the body overlaps them.
	const wheelW = 26;
	const wheelH = 14;
	const wheelCx = { front: 34, rear: -42 };
	for (const cx of [wheelCx.front, wheelCx.rear]) {
		for (const cy of [-HALF_WID, HALF_WID]) {
			g.appendChild(
				shape("rect", {
					x: cx - wheelW / 2,
					y: cy - wheelH / 2,
					width: wheelW,
					height: wheelH,
					rx: 4,
					fill: WHEEL_FILL,
				}),
			);
		}
	}

	// Body: rounded rear, tapered pointed nose toward +x.
	const noseStart = HALF_LEN - 26;
	const rearRound = HALF_LEN - 12;
	const noseCtl = HALF_LEN - 10;
	const bodyD =
		`M ${-rearRound} ${-HALF_WID}` +
		` L ${noseStart} ${-HALF_WID}` +
		` Q ${noseCtl} ${-HALF_WID} ${HALF_LEN} 0` +
		` Q ${noseCtl} ${HALF_WID} ${noseStart} ${HALF_WID}` +
		` L ${-rearRound} ${HALF_WID}` +
		` Q ${-HALF_LEN} ${HALF_WID} ${-HALF_LEN} 0` +
		` Q ${-HALF_LEN} ${-HALF_WID} ${-rearRound} ${-HALF_WID} Z`;
	g.appendChild(
		shape("path", {
			d: bodyD,
			fill: BODY_FILL,
			stroke: OUTLINE,
			"stroke-width": OUTLINE_W,
			"stroke-linejoin": "round",
		}),
	);

	// Windshield/cockpit: trapezoid narrowing toward the nose (reinforces forward).
	g.appendChild(
		shape("path", {
			d: "M 30 -12 L 30 12 L -4 19 L -4 -19 Z",
			fill: GLASS_FILL,
			stroke: OUTLINE,
			"stroke-width": 2,
			"stroke-linejoin": "round",
		}),
	);

	// Driver helmet dot.
	g.appendChild(shape("circle", { cx: 6, cy: 0, r: 6, fill: HELMET_FILL }));

	return g;
}

/** Place + aim the car at arc-length `dist` along the sampler. */
export function positionCar(car: SVGGElement, sampler: PathSampler, dist: number): void {
	const p = sampler.pointAt(dist);
	const deg = sampler.headingDeg(dist);
	const x = Math.round(p.x * 100) / 100;
	const y = Math.round(p.y * 100) / 100;
	const r = Math.round(deg * 100) / 100;
	car.setAttribute("transform", `translate(${x} ${y}) rotate(${r}) scale(${CAR_SCALE})`);
}
