import JSZip from 'jszip';
import { parseGIF, decompressFrames } from 'gifuct-js';

export type DitherType = 'atkinson' | 'floyd-steinberg' | 'bayer' | 'threshold';
export type CompressionType = 'none' | 'rle' | 'delta';

export interface ProcessSettings {
  width: number;
  height: number;
  ditherType: DitherType;
  threshold: number;
  invert: boolean;
  compression: CompressionType;
  targetFps: number;
}

export interface ProcessedFrame {
  data: Uint8Array;
  delay: number;
  previewUrl: string;
  originalPreviewUrl: string;
}

export interface ProcessedFile {
  id: string;
  name: string;
  file: File;
  status: 'pending' | 'processing' | 'done' | 'error';
  frames: ProcessedFrame[];
  binary: Uint8Array;
  cArray: string;
  previewUrl: string;
  originalPreviewUrl: string;
  error?: string;
  settings: ProcessSettings;
  useGlobalSettings: boolean;
}

export async function processFile(file: File, settings: ProcessSettings): Promise<Partial<ProcessedFile>> {
  try {
    const frames = await decodeFile(file);
    
    let framesToProcess = frames;
    if (frames.length > 1 && settings.targetFps > 0) {
      const totalDelay = frames.reduce((acc, f) => acc + f.delay, 0);
      const avgDelay = totalDelay / frames.length;
      const originalFps = 1000 / avgDelay;
      
      if (settings.targetFps < originalFps) {
        const ratio = originalFps / settings.targetFps;
        framesToProcess = frames.filter((_, i) => i % Math.round(ratio) === 0);
        framesToProcess.forEach(f => f.delay = Math.round(avgDelay * ratio));
      }
    }
    
    const processedFrames: ProcessedFrame[] = [];
    let previewUrl = '';
    let originalPreviewUrl = '';

    let prevBytes: Uint8Array | null = null;

    for (let i = 0; i < framesToProcess.length; i++) {
      const frame = framesToProcess[i];
      const canvas = renderToCanvas(frame);
      const resized = applyResize(canvas, settings.width, settings.height);
      const ctx = resized.getContext('2d')!;
      
      if (i === 0) {
        originalPreviewUrl = resized.toDataURL('image/png');
      }

      applyDithering(ctx, settings.width, settings.height, settings.threshold, settings.ditherType);
      
      if (i === 0) {
        previewUrl = resized.toDataURL('image/png');
      }

      const bytes = canvas2bytes(resized, settings.invert);
      const compressed = compressFrame(bytes, settings.compression, prevBytes);
      
      processedFrames.push({ 
        data: compressed, 
        delay: frame.delay,
        previewUrl: resized.toDataURL('image/png'),
        originalPreviewUrl: canvas.toDataURL('image/png')
      });
      prevBytes = bytes;
    }

    const binary = buildAnimation(processedFrames, settings);
    const cArray = buildCArray(file.name, binary);

    return {
      status: 'done',
      frames: processedFrames,
      binary,
      cArray,
      previewUrl,
      originalPreviewUrl
    };

  } catch (error: any) {
    return { status: 'error', error: error.message };
  }
}

async function decodeFile(file: File): Promise<{ imageData: ImageData; delay: number }[]> {
  if (file.type === 'image/gif') {
    const buffer = await file.arrayBuffer();
    const parsed = parseGIF(buffer);
    const frames = decompressFrames(parsed, true);
    
    return frames.map(f => {
      const clamped = new Uint8ClampedArray(f.patch);
      const imageData = new ImageData(clamped, f.dims.width, f.dims.height);
      return { imageData, delay: f.delay };
    });
  } else {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        resolve([{ imageData: ctx.getImageData(0, 0, img.width, img.height), delay: 100 }]);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
}

function renderToCanvas(frame: { imageData: ImageData; delay: number }): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = frame.imageData.width;
  canvas.height = frame.imageData.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(frame.imageData, 0, 0);
  return canvas;
}

function applyResize(canvas: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  const temp = document.createElement('canvas');
  temp.width = width;
  temp.height = height;
  const ctx = temp.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0, width, height);
  return temp;
}

function applyDithering(ctx: CanvasRenderingContext2D, width: number, height: number, threshold: number, type: DitherType) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Convert to grayscale
  for (let i = 0; i < data.length; i += 4) {
    const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    data[i] = data[i + 1] = data[i + 2] = luma;
  }

  if (type === 'threshold') {
    for (let i = 0; i < data.length; i += 4) {
      const val = data[i] >= threshold ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = val;
    }
  } else if (type === 'atkinson') {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const oldPixel = data[idx];
        const newPixel = oldPixel >= threshold ? 255 : 0;
        data[idx] = data[idx + 1] = data[idx + 2] = newPixel;
        const err = Math.floor((oldPixel - newPixel) / 8);

        const distribute = (dx: number, dy: number) => {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nidx = (ny * width + nx) * 4;
            data[nidx] = Math.min(255, Math.max(0, data[nidx] + err));
            data[nidx+1] = data[nidx];
            data[nidx+2] = data[nidx];
          }
        };

        distribute(1, 0);
        distribute(2, 0);
        distribute(-1, 1);
        distribute(0, 1);
        distribute(1, 1);
        distribute(0, 2);
      }
    }
  } else if (type === 'floyd-steinberg') {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const oldPixel = data[idx];
        const newPixel = oldPixel >= threshold ? 255 : 0;
        data[idx] = data[idx + 1] = data[idx + 2] = newPixel;
        const err = oldPixel - newPixel;

        const distribute = (dx: number, dy: number, factor: number) => {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nidx = (ny * width + nx) * 4;
            data[nidx] = Math.min(255, Math.max(0, data[nidx] + err * factor));
            data[nidx+1] = data[nidx];
            data[nidx+2] = data[nidx];
          }
        };

        distribute(1, 0, 7/16);
        distribute(-1, 1, 3/16);
        distribute(0, 1, 5/16);
        distribute(1, 1, 1/16);
      }
    }
  } else if (type === 'bayer') {
    const bayerMatrix = [
      [ 0, 8, 2, 10],
      [12, 4, 14, 6],
      [ 3, 11, 1, 9],
      [15, 7, 13, 5]
    ];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const luma = data[idx];
        const bayerValue = (bayerMatrix[y % 4][x % 4] / 16) * 255;
        const adjustedThreshold = threshold + (bayerValue - 128);
        const newPixel = luma >= adjustedThreshold ? 255 : 0;
        data[idx] = data[idx + 1] = data[idx + 2] = newPixel;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

function canvas2bytes(canvas: HTMLCanvasElement, invert: boolean): Uint8Array {
  const ctx = canvas.getContext('2d')!;
  const width = canvas.width;
  const height = canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height).data;
  
  const pages = Math.ceil(height / 8);
  const bytes = new Uint8Array(pages * width);

  let i = 0;
  for (let page = 0; page < pages; page++) {
    for (let x = 0; x < width; x++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const y = page * 8 + bit;
        if (y < height) {
          const idx = (y * width + x) * 4;
          const isWhite = imageData[idx] > 127;
          const isOn = invert ? !isWhite : isWhite;
          if (isOn) {
            byte |= (1 << bit);
          }
        }
      }
      bytes[i++] = byte;
    }
  }
  return bytes;
}

function rleCompress(data: Uint8Array): Uint8Array {
  const result: number[] = [];
  let count = 1;
  for (let i = 1; i <= data.length; i++) {
    if (i < data.length && data[i] === data[i - 1] && count < 255) {
      count++;
    } else {
      result.push(data[i - 1], count);
      count = 1;
    }
  }
  return new Uint8Array(result);
}

function deltaCompress(prev: Uint8Array, current: Uint8Array): Uint8Array {
  const result: number[] = [];
  for (let i = 0; i < current.length; i++) {
    if (current[i] !== prev[i]) {
      result.push(i & 0xff, (i >> 8) & 0xff, current[i]);
    }
  }
  return new Uint8Array(result);
}

function compressFrame(data: Uint8Array, type: CompressionType, prevFrame: Uint8Array | null): Uint8Array {
  if (type === 'rle') return rleCompress(data);
  if (type === 'delta' && prevFrame) return deltaCompress(prevFrame, data);
  return data;
}

function buildAnimation(frames: ProcessedFrame[], settings: ProcessSettings): Uint8Array {
  const output: number[] = [];
  
  output.push(settings.width & 0xff, settings.height & 0xff);
  output.push(frames.length & 0xff, (frames.length >> 8) & 0xff);
  
  let compType = 0;
  if (settings.compression === 'rle') compType = 1;
  if (settings.compression === 'delta') compType = 2;
  output.push(compType);

  for (const frame of frames) {
    output.push(frame.data.length & 0xff, (frame.data.length >> 8) & 0xff);
    output.push(frame.delay & 0xff, (frame.delay >> 8) & 0xff);
    for (let i = 0; i < frame.data.length; i++) {
      output.push(frame.data[i]);
    }
  }

  return new Uint8Array(output);
}

function buildCArray(filename: string, binary: Uint8Array): string {
  const safeName = filename.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  let cArray = `const uint8_t ${safeName}_bits[] PROGMEM = {\n  `;
  for (let i = 0; i < binary.length; i++) {
    cArray += `0x${binary[i].toString(16).padStart(2, '0')}`;
    if (i < binary.length - 1) {
      cArray += ', ';
    }
    if ((i + 1) % 16 === 0) {
      cArray += '\n  ';
    }
  }
  cArray += '\n};';
  return cArray;
}

export async function exportZIP(results: ProcessedFile[]): Promise<Blob> {
  const zip = new JSZip();
  for (const file of results) {
    if (file.status === 'done') {
      const safeName = file.name.replace(/\.[^/.]+$/, "");
      zip.file(`${safeName}.bin`, file.binary);
      zip.file(`${safeName}.h`, file.cArray);
    }
  }
  return await zip.generateAsync({ type: "blob" });
}

export function buildCombinedBinary(results: ProcessedFile[]): { offsets: number[], data: Uint8Array } {
  const offsets: number[] = [];
  const data: number[] = [];
  let offset = 0;

  for (const file of results) {
    if (file.status === 'done') {
      offsets.push(offset);
      for (let i = 0; i < file.binary.length; i++) {
        data.push(file.binary[i]);
      }
      offset += file.binary.length;
    }
  }

  return {
    offsets,
    data: new Uint8Array(data)
  };
}
