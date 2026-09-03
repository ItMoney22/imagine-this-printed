// imagetracerjs ships no types. Only the one entry point we use is declared,
// with the options this codebase actually passes — an `any` here would hide a
// typo in an option name, and a mistyped option is silently ignored by the
// library rather than throwing, which would look like the tracer "just not
// working".
declare module 'imagetracerjs' {
  export interface TracerOptions {
    numberofcolors?: number
    ltres?: number
    qtres?: number
    pathomit?: number
    viewbox?: boolean
    linefilter?: boolean
    strokewidth?: number
    roundcoords?: number
    blurradius?: number
    blurdelta?: number
    colorquantcycles?: number
    colorsampling?: number
    scale?: number
  }
  export interface TracerImageData {
    width: number
    height: number
    data: Uint8ClampedArray
  }
  export function imagedataToSVG(imgd: TracerImageData, options?: TracerOptions): string
  const ImageTracer: { imagedataToSVG: typeof imagedataToSVG }
  export default ImageTracer
}
