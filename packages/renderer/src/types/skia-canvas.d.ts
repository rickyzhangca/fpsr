/** Ambient stub so fpsr/node typechecks without skia-canvas installed. */
declare module "skia-canvas" {
  export class Image {
    clear(): void;
    decode(data: Buffer | Uint8Array): Promise<void> | void;
  }

  export class Canvas {
    constructor(width: number, height: number);
    width: number;
    height: number;
    getContext(type: "2d"): unknown;
    toBuffer(mime?: string, options?: { quality?: number }): Buffer | Promise<Buffer>;
  }
}
