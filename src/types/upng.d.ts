declare module 'upng-js' {
  interface UPNGImage {
    width: number
    height: number
    depth: number
    ctype: number
    channels: number
    cnum: number
    data: Uint8Array
  }
  const UPNG: {
    decode(buffer: ArrayBuffer | Uint8Array): UPNGImage
    toRGBA8(img: UPNGImage): ArrayBuffer[]
    encode(images: ArrayBuffer[] | Uint8Array[], width: number, height: number, cnum: number): ArrayBuffer
  }
  export default UPNG
}
