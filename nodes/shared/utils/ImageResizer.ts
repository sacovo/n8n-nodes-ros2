/**
 * Downscale/re-encode images with sharp to reduce their size before they are
 * handed to a downstream consumer (e.g. a vision language model, where the
 * token cost grows with the image dimensions).
 */

import sharp from 'sharp';

export interface ResizeOptions {
    /** Maximum output width in pixels. Omit or set to 0 to leave width unbounded. */
    maxWidth?: number;
    /** Maximum output height in pixels. Omit or set to 0 to leave height unbounded. */
    maxHeight?: number;
    /** Encoder quality (1-100) for lossy output formats (JPEG/WebP). */
    quality?: number;
}

export interface ResizeResult {
    buffer: Buffer;
    width: number;
    height: number;
    /** Normalized output format, e.g. 'jpeg', 'png' or 'webp'. */
    format: string;
}

// sharp can decode many formats but can only encode a subset. Anything it
// cannot re-encode (bmp, gif, tiff, ...) is normalized to JPEG.
type OutputFormat = 'jpeg' | 'png' | 'webp';

export class ImageResizer {
    static async resize(input: Buffer, options: ResizeOptions): Promise<ResizeResult> {
        const { maxWidth, maxHeight, quality } = options;

        const metadata = await sharp(input, { failOn: 'none' }).metadata();
        const inputFormat = metadata.format ?? 'jpeg';
        const outputFormat: OutputFormat = inputFormat === 'png' ? 'png' : inputFormat === 'webp' ? 'webp' : 'jpeg';

        let pipeline = sharp(input, { failOn: 'none' });

        if ((maxWidth && maxWidth > 0) || (maxHeight && maxHeight > 0)) {
            pipeline = pipeline.resize({
                width: maxWidth && maxWidth > 0 ? maxWidth : undefined,
                height: maxHeight && maxHeight > 0 ? maxHeight : undefined,
                // Shrink to fit inside the box while preserving aspect ratio,
                // and never enlarge an image that is already smaller.
                fit: 'inside',
                withoutEnlargement: true,
            });
        }

        switch (outputFormat) {
            case 'png':
                pipeline = pipeline.png();
                break;
            case 'webp':
                pipeline = pipeline.webp(quality !== undefined ? { quality } : {});
                break;
            default:
                pipeline = pipeline.jpeg(quality !== undefined ? { quality } : {});
                break;
        }

        const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
        return { buffer: data, width: info.width, height: info.height, format: info.format };
    }
}
