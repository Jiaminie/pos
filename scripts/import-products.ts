import 'dotenv/config'
import * as fs from 'fs'
import * as path from 'path'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

function resolveConnectionString(url: string): string {
  if (url.startsWith('prisma+postgres://')) {
    const apiKey = new URL(url).searchParams.get('api_key')!
    return JSON.parse(Buffer.from(apiKey, 'base64').toString()).databaseUrl
  }
  return url
}

const connectionString = resolveConnectionString(process.env.DATABASE_URL!)
const prisma = new PrismaClient({ adapter: new PrismaPg(connectionString) })

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function generateSku(name: string, spec: string): string {
  const base = spec ? `${slugify(name)}-${slugify(spec)}` : slugify(name)
  return base.slice(0, 60)
}

function parsePrice(val: string): number {
  if (!val || val.trim() === '') return 0
  const num = parseFloat(val.replace(/[^0-9.]/g, ''))
  return isNaN(num) ? 0 : num
}

function inferCategory(name: string): string {
  const n = name.toLowerCase()
  if (/tangit|silicon|sillicon|tizo|era 500|dlg|red glue|arldite|ardalite|pvc glue|boss white|aquafix|magnifier|cement|pvc bond/.test(n))
    return 'Adhesives & Sealants'
  if (/tap|mixer|faucet|shower rose|ena shower/.test(n))
    return 'Taps & Faucets'
  if (/grinding|poly disc|diamond|cutting disc|cutting wood|cutting iron|rhodius/.test(n))
    return 'Abrasives & Cutting Discs'
  if (/screwdriver|hacksaw|chalk|spirit level|pliers|trowel|chuck|drill|jigsaw|flat bits|chisel|solder|electrode|maders|pipe wrench|shackle|hand saw|shears|glass cutter|shovel|allen key|pipe cutter|aloe brush|corona brush|end clothing|solar welding/.test(n))
    return 'Tools & Equipment'
  if (/valve|bullcock|ang valve|float valve|neat valve|hanks|magic valve|gate valve|automatic control/.test(n))
    return 'Valves'
  if (/toilet|bathroom shelf|soap|tissue holder|drying rack|toothbrush|bottle trap|urinal|suction|super douch/.test(n))
    return 'Bathroom Accessories'
  if (/lock|door lock/.test(n))
    return 'Locks & Security'
  if (/clip|insulating tape|thread seal|binding wire|gypsum screw|screw|steel nail|self-tap/.test(n))
    return 'Clips & Fasteners'
  return 'Pipes & Fittings'
}

function parseLine(line: string): string[] {
  const cols: string[] = []
  let cur = ''
  let inQuote = false
  let fieldStart = true
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (fieldStart && ch === '"') {
      inQuote = true
      fieldStart = false
    } else if (inQuote && ch === '"') {
      if (line[i + 1] === '"') { cur += '"'; i++ }
      else { inQuote = false }
    } else if (ch === ',' && !inQuote) {
      cols.push(cur.trim()); cur = ''; fieldStart = true
    } else {
      cur += ch; fieldStart = false
    }
  }
  cols.push(cur.trim())
  return cols
}

type ProductRow = {
  name: string
  specification: string | null
  sku: string
  quantity: string | null
  costPrice: number
  sellingPrice: number
  category: string
}

function parseCsv(filePath: string): ProductRow[] {
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.trim().split('\n').slice(1) // skip header
  const skuCount: Record<string, number> = {}

  return lines
    .map(line => {
      const cols = parseLine(line)

      const [name, spec, quantity, wholesale, retail] = cols
      if (!name) return null

      const baseSku = generateSku(name, spec ?? '')
      skuCount[baseSku] = (skuCount[baseSku] ?? 0) + 1
      const sku = skuCount[baseSku] > 1 ? `${baseSku}-${skuCount[baseSku]}` : baseSku

      return {
        name: name.trim(),
        specification: spec?.trim() || null,
        sku,
        quantity: quantity?.trim() || null,
        costPrice: parsePrice(wholesale ?? ''),
        sellingPrice: parsePrice(retail ?? ''),
        category: inferCategory(name.trim()),
      }
    })
    .filter((p): p is ProductRow => p !== null)
}

async function main() {
  console.log('Clearing existing products...')
  await prisma.product.deleteMany()
  console.log('Cleared.')

  const csvPath = path.join(__dirname, 'products.csv')
  const products = parseCsv(csvPath)
  console.log(`Importing ${products.length} products...`)

  let created = 0
  for (const p of products) {
    await prisma.product.create({ data: p })
    created++
  }

  console.log(`Done. ${created} products imported.`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
