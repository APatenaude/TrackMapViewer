/*
 * A new track's photo, re-encoded before use: the browser shows a phone JPEG turned by its
 * EXIF orientation but vips tiles the raw pixels, so the saved image.jpg must already be
 * upright; re-encoding also drops EXIF/GPS data and caps the size at what a canvas handles.
 */

const MAX_SIDE = 16384;
const QUALITY = 0.92;

export interface Photo {
	blob: Blob;
	width: number;
	height: number;
}

export async function loadPhoto(file: Blob): Promise<Photo> {
	const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
	try {
		const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
		const width = Math.round(bitmap.width * scale);
		const height = Math.round(bitmap.height * scale);
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("this browser can't process the photo");
		ctx.drawImage(bitmap, 0, 0, width, height);
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
		if (!blob) throw new Error("the photo is too large for this browser");
		return { blob, width, height };
	} finally {
		bitmap.close();
	}
}
