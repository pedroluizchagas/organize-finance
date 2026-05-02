import pdfParse from 'pdf-parse'

export interface PDFParseResult {
  rawLines: string[]
  text: string
}

/**
 * Extracts raw text lines from a PDF bank statement.
 * The caller (AI processing worker) is responsible for interpreting the lines.
 */
export async function parsePDF(fileBuffer: Buffer): Promise<PDFParseResult> {
  const data = await pdfParse(fileBuffer)

  const rawLines = data.text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  return {
    rawLines,
    text: data.text,
  }
}
