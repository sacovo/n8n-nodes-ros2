import sharp from 'sharp';
import { ImageResizer } from '../utils/ImageResizer';

async function makeImage(width: number, height: number, format: 'jpeg' | 'png' | 'webp'): Promise<Buffer> {
    const base = sharp({
        create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } },
    });
    if (format === 'png') return base.png().toBuffer();
    if (format === 'webp') return base.webp().toBuffer();
    return base.jpeg().toBuffer();
}

describe('ImageResizer', () => {
    it('downscales to fit inside the box while preserving aspect ratio', async () => {
        const input = await makeImage(1600, 800, 'jpeg');

        const result = await ImageResizer.resize(input, { maxWidth: 400, maxHeight: 400 });

        expect(result.format).toBe('jpeg');
        expect(result.width).toBe(400);
        expect(result.height).toBe(200);
        expect(result.buffer.length).toBeLessThan(input.length);
    });

    it('never enlarges an image that is already smaller than the box', async () => {
        const input = await makeImage(320, 240, 'jpeg');

        const result = await ImageResizer.resize(input, { maxWidth: 1024, maxHeight: 1024 });

        expect(result.width).toBe(320);
        expect(result.height).toBe(240);
    });

    it('bounds a single dimension when only one max is given', async () => {
        const input = await makeImage(1000, 500, 'jpeg');

        const result = await ImageResizer.resize(input, { maxWidth: 200 });

        expect(result.width).toBe(200);
        expect(result.height).toBe(100);
    });

    it('preserves PNG input as PNG output', async () => {
        const input = await makeImage(800, 600, 'png');

        const result = await ImageResizer.resize(input, { maxWidth: 100 });

        expect(result.format).toBe('png');
        expect(result.width).toBe(100);
    });

    it('re-encodes formats sharp cannot output (e.g. GIF) to JPEG', async () => {
        const input = await sharp({
            create: { width: 400, height: 400, channels: 3, background: { r: 0, g: 0, b: 0 } },
        })
            .gif()
            .toBuffer();

        const result = await ImageResizer.resize(input, { maxWidth: 100 });

        expect(result.format).toBe('jpeg');
        expect(result.width).toBe(100);
    });
});
