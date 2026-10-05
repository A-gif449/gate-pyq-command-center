type PdfModule = typeof import('pdfjs-dist')
let pdfLibPromise: Promise<PdfModule> | null = null
const loads: Record<string, Promise<import('pdfjs-dist').PDFDocumentProxy> | undefined> = {}
const files: Record<string, string> = { v1: '/pyq-volume1.pdf', v2: '/pyq-volume2.pdf', v3: '/pyq-volume3.pdf' }
async function getPdfLib() {
  if (!pdfLibPromise) {
    pdfLibPromise = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = (worker as { default: string }).default
      return lib
    })
  }
  return pdfLibPromise
}
export async function getPdf(volume: string = 'v2') {
  if (!loads[volume]) {
    loads[volume] = getPdfLib().then(pdfjsLib => pdfjsLib.getDocument(files[volume] ?? files.v2).promise)
  }
  return loads[volume]!
}
export async function renderCrop(canvas: HTMLCanvasElement, segment: { pdf?: string; page:number;x:number;y:number;w:number;h:number }, pixelRatio=Math.min(window.devicePixelRatio||1,2)) {
 const pdf=await getPdf(segment.pdf ?? 'v2'); const page=await pdf.getPage(segment.page); const scale=1.8*pixelRatio; const viewport=page.getViewport({scale});
 canvas.width=Math.max(1,Math.ceil(segment.w*scale)); canvas.height=Math.max(1,Math.ceil(segment.h*scale)); canvas.style.width=`${Math.ceil(segment.w*1.8)}px`; canvas.style.height=`${Math.ceil(segment.h*1.8)}px`; canvas.style.display='block';
 const context=canvas.getContext('2d',{alpha:false}); if(!context)throw new Error('Canvas unavailable');
 await page.render({canvas,canvasContext:context,viewport,transform:[1,0,0,1,-segment.x*scale,-segment.y*scale]}).promise
}
export async function warmPages(segments: Array<{pdf?:string;page:number}>) {
 await Promise.all(Object.entries(segments.reduce<Record<string,number[]>>((acc,s)=>{(acc[s.pdf??'v2']??=[]).push(s.page);return acc},{})).map(async([volume,pages])=>{const pdf=await getPdf(volume);await Promise.all([...new Set(pages)].map(n=>pdf.getPage(n)))}))
}
