import Anthropic from '@anthropic-ai/sdk'
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema'
import type { ExtractedStockCountRow } from '@/lib/stock-count/types'

const EXTRACT_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          qty: { type: 'number' },
          sizeType: { type: ['string', 'null'] },
          type: { type: ['string', 'null'] },
          company: { type: ['string', 'null'] },
        },
        required: ['description', 'qty', 'sizeType', 'type', 'company'],
        additionalProperties: false,
      },
    },
  },
  required: ['rows'],
  additionalProperties: false,
} as const

const EXTRACT_OUTPUT_FORMAT = jsonSchemaOutputFormat(EXTRACT_OUTPUT_SCHEMA)

const EXTRACTION_PROMPT = `This image is a handwritten stock count form used in a retail/hardware store.

Extract every line item you can read. For each row return:
- description: product name / description as written
- qty: counted quantity (number)
- sizeType: size or unit column if present, else null
- type: product type/category column if present, else null
- company: brand or company column if present, else null

Ignore header rows and totals. If a cell is illegible, skip that row rather than guessing.
Return JSON matching the schema with all readable rows in "rows".`

let anthropicClient: Anthropic | null = null

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey })
  return anthropicClient
}

export function anthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

function normalizeRow(row: ExtractedStockCountRow): ExtractedStockCountRow {
  return {
    description: String(row.description ?? '').trim(),
    qty: Number(row.qty),
    sizeType: row.sizeType != null ? String(row.sizeType) : null,
    type: row.type != null ? String(row.type) : null,
    company: row.company != null ? String(row.company) : null,
  }
}

export async function extractStockCountRows(imageUrl: string): Promise<ExtractedStockCountRow[]> {
  const client = getAnthropicClient()
  if (!client) {
    throw new Error('ANTHROPIC_API_KEY is not configured — photo extraction is unavailable')
  }

  const message = await client.messages.parse({
    model: 'claude-opus-4-8',
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'url', url: imageUrl },
          },
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      },
    ],
    output_config: {
      format: EXTRACT_OUTPUT_FORMAT,
    },
  })

  const rows = message.parsed_output?.rows
  if (!Array.isArray(rows)) {
    throw new Error('Extraction model returned unexpected shape')
  }

  return rows
    .map(normalizeRow)
    .filter((row) => row.description.length > 0 && Number.isFinite(row.qty))
}
