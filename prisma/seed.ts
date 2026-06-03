import "dotenv/config";
import { PrismaClient } from '../app/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

function resolveConnectionString(url: string): string {
  // prisma+postgres:// URLs embed the real connection string in the api_key param
  if (url.startsWith('prisma+postgres://')) {
    const apiKey = new URL(url).searchParams.get('api_key')!
    return JSON.parse(Buffer.from(apiKey, 'base64').toString()).databaseUrl
  }
  return url
}

const connectionString = resolveConnectionString(process.env.DATABASE_URL!)
const prisma = new PrismaClient({ adapter: new PrismaPg(connectionString) })

const items = [
  // ── Adhesives & Sealants ────────────────────────────────────────────────
  { name: 'Tangit', specification: '250ml', quantity: '1 box', category: 'Adhesives & Sealants' },
  { name: 'Tangit', specification: '500ml', quantity: '1 box', category: 'Adhesives & Sealants' },
  { name: 'Tangit', specification: '250ml', quantity: '1 box', category: 'Adhesives & Sealants' },
  { name: 'Tangit', specification: '500ml', quantity: '1 box + 14 pieces', category: 'Adhesives & Sealants' },
  { name: 'Silicon gp ntc - Henkel clear', specification: null, quantity: '17 pieces', category: 'Adhesives & Sealants' },
  { name: 'Silicon sheng bao', specification: null, quantity: '1 box', category: 'Adhesives & Sealants' },
  { name: 'Tizo', specification: null, quantity: '1 box', category: 'Adhesives & Sealants' },
  { name: 'Era 500ml', specification: null, quantity: '1 box', category: 'Adhesives & Sealants' },
  { name: 'DLG 243ml', specification: null, quantity: '1 box', category: 'Adhesives & Sealants' },
  { name: 'DLG silicon', specification: null, quantity: '1 box', category: 'Adhesives & Sealants' },
  { name: 'Potoc black', specification: null, quantity: '11 pcs', category: 'Adhesives & Sealants' },
  { name: 'Potoc white', specification: null, quantity: '8 pcs', category: 'Adhesives & Sealants' },
  { name: 'Potoc clear', specification: null, quantity: '10 pcs', category: 'Adhesives & Sealants' },
  { name: 'PPR cement', specification: '1/2"', quantity: '100 pcs', category: 'Adhesives & Sealants' },
  { name: 'PVC bond', specification: '4"', quantity: '40 pcs', category: 'Adhesives & Sealants' },
  { name: 'Red glue', specification: null, quantity: '33 pcs (pump)', category: 'Adhesives & Sealants' },
  { name: 'Arldite', specification: '4 packets', quantity: '4 packets', category: 'Adhesives & Sealants' },
  { name: 'Ardalite', specification: null, quantity: '4 pcs', category: 'Adhesives & Sealants' },
  { name: 'Aquafix - wall', specification: null, quantity: '1 packet', category: 'Adhesives & Sealants' },
  { name: 'Magnifier pillar', specification: null, quantity: '2 packets', category: 'Adhesives & Sealants' },
  { name: 'PVC glue', specification: '1/2L', quantity: '5 pcs', category: 'Adhesives & Sealants' },
  { name: 'Boss white', specification: '400g', quantity: '10 pcs', category: 'Adhesives & Sealants' },
  { name: 'Boss white', specification: '1/4kg', quantity: '10 pcs', category: 'Adhesives & Sealants' },
  { name: 'Super douch foam', specification: null, quantity: '2 pcs', category: 'Adhesives & Sealants' },

  // ── Taps & Faucets ──────────────────────────────────────────────────────
  { name: 'KK basin tap', specification: null, quantity: '10 pcs', category: 'Taps & Faucets' },
  { name: 'Pillar tap linko', specification: null, quantity: '10 pcs', category: 'Taps & Faucets' },
  { name: 'Wall tap linko', specification: null, quantity: '10 pcs', category: 'Taps & Faucets' },
  { name: 'Pillar self closing', specification: null, quantity: '4 pcs', category: 'Taps & Faucets' },
  { name: 'Kingmisa mixer', specification: null, quantity: '3 pcs', category: 'Taps & Faucets' },
  { name: 'Uzuri kitchen tap', specification: null, quantity: '10 pcs', category: 'Taps & Faucets' },
  { name: 'PPR tap', specification: '1/2"', quantity: '20 pcs', category: 'Taps & Faucets' },
  { name: 'BPF tap', specification: null, quantity: '25 pcs', category: 'Taps & Faucets' },
  { name: 'Garden tap', specification: '3/4"', quantity: '5 pcs', category: 'Taps & Faucets' },
  { name: 'Garden tap', specification: '1/2"', quantity: '4 pcs', category: 'Taps & Faucets' },
  { name: 'PPR handle bar', specification: '3/4"', quantity: '3 pcs', category: 'Taps & Faucets' },
  { name: 'PPR handle bar', specification: '1/2"', quantity: '3 pcs', category: 'Taps & Faucets' },
  { name: 'Basin mixers', specification: null, quantity: '2 pcs', category: 'Taps & Faucets' },
  { name: 'Wash tap (Chrome)', specification: null, quantity: '2 pcs', category: 'Taps & Faucets' },
  { name: 'Pillar tap (plastic)', specification: null, quantity: '5 pcs', category: 'Taps & Faucets' },
  { name: 'Pillar tap (waste)', specification: null, quantity: '5 pcs', category: 'Taps & Faucets' },

  // ── Pipes & Fittings ────────────────────────────────────────────────────
  { name: 'MTD bush', specification: '4x3', quantity: '50 pcs', category: 'Pipes & Fittings' },
  { name: 'MTD bush', specification: '4x2', quantity: '50 pcs', category: 'Pipes & Fittings' },
  { name: 'MTD bush', specification: null, quantity: '200 pcs', category: 'Pipes & Fittings' },
  { name: 'Plug', specification: '3"', quantity: '40 pcs', category: 'Pipes & Fittings' },
  { name: '1 way', specification: null, quantity: '20 pcs', category: 'Pipes & Fittings' },
  { name: '4" 45° bend', specification: null, quantity: '16 pcs', category: 'Pipes & Fittings' },
  { name: '4 way', specification: null, quantity: '15 pcs', category: 'Pipes & Fittings' },
  { name: 'MTD sec', specification: '3/4"', quantity: '50 pcs', category: 'Pipes & Fittings' },
  { name: 'Tee', specification: '2" PVC', quantity: '50 pcs', category: 'Pipes & Fittings' },
  { name: 'Bend', specification: '2" 90°', quantity: '15 pcs', category: 'Pipes & Fittings' },
  { name: 'Bend', specification: '3"', quantity: '25 pcs', category: 'Pipes & Fittings' },
  { name: 'Tee', specification: '3"', quantity: '10 pcs', category: 'Pipes & Fittings' },
  { name: 'Tank connector', specification: '1/2"', quantity: '2 pcs', category: 'Pipes & Fittings' },
  { name: 'Tank connector', specification: '3/4"', quantity: '8 pcs', category: 'Pipes & Fittings' },
  { name: 'Tank connector', specification: '1"', quantity: '5 pcs', category: 'Pipes & Fittings' },
  { name: 'Tank connector', specification: '1 1/2"', quantity: '2 pcs', category: 'Pipes & Fittings' },
  { name: 'Tank connector', specification: '2"', quantity: '3 pcs', category: 'Pipes & Fittings' },
  { name: 'Conn strip', specification: null, quantity: '200 pcs', category: 'Pipes & Fittings' },
  { name: 'Tail off', specification: null, quantity: '200 pcs', category: 'Pipes & Fittings' },
  { name: 'End cap', specification: null, quantity: '100 pcs', category: 'Pipes & Fittings' },
  { name: 'PPR union', specification: '32mm', quantity: '1 pkt', category: 'Pipes & Fittings' },
  { name: 'PPR union', specification: '20mm', quantity: '16 pcs', category: 'Pipes & Fittings' },
  { name: 'PVC H/D coupling', specification: '32mm', quantity: '19 pcs', category: 'Pipes & Fittings' },
  { name: 'Tee', specification: '3/4" PPR', quantity: '160 pcs', category: 'Pipes & Fittings' },
  { name: 'Elbow', specification: '1/2" PPR', quantity: '300 pcs', category: 'Pipes & Fittings' },
  { name: 'Socket', specification: '1/2" PPR', quantity: '160 pcs', category: 'Pipes & Fittings' },
  { name: 'PPR socket', specification: '3/4"', quantity: '54 pcs', category: 'Pipes & Fittings' },
  { name: 'Socket', specification: '1" PPR', quantity: '10 pcs', category: 'Pipes & Fittings' },
  { name: 'Elbow', specification: '1" PPR', quantity: '12 pcs', category: 'Pipes & Fittings' },
  { name: 'PVC socket', specification: '1" PPR', quantity: '1 pc', category: 'Pipes & Fittings' },
  { name: 'Adapting socket', specification: '3/4" x 1/2"', quantity: '12 pcs', category: 'Pipes & Fittings' },
  { name: 'Reducing socket', specification: '32x25mm', quantity: '15 pcs', category: 'Pipes & Fittings' },
  { name: 'Reducing PVC', specification: '2" - 1 1/2"', quantity: '2 pcs', category: 'Pipes & Fittings' },
  { name: 'MTD MI', specification: '50mm', quantity: '1 pc', category: 'Pipes & Fittings' },
  { name: 'MTD MI', specification: '40mm', quantity: '1 pc', category: 'Pipes & Fittings' },
  { name: 'Dubi sinks', specification: '1" PPR', quantity: '1 pc', category: 'Pipes & Fittings' },
  { name: 'Knit (MTD)', specification: '1/2"', quantity: '20 pcs', category: 'Pipes & Fittings' },
  { name: 'Nipple', specification: '1/2"', quantity: '15 pcs', category: 'Pipes & Fittings' },
  { name: 'Super union (plastic)', specification: null, quantity: '2 pcs', category: 'Pipes & Fittings' },
  { name: 'Shoshana', specification: null, quantity: '5 pcs', category: 'Pipes & Fittings' },
  { name: 'H/down', specification: '20mm', quantity: '2 pcs', category: 'Pipes & Fittings' },
  { name: 'Dop caps', specification: null, quantity: '2 pcs', category: 'Pipes & Fittings' },
  { name: 'PPR pipe', specification: '1/2" 50m', quantity: '1 pc', category: 'Pipes & Fittings' },
  { name: 'PPR pipe', specification: '1/2" 15m', quantity: '1 pc', category: 'Pipes & Fittings' },
  { name: 'PPR pipe', specification: '1/2" 30m', quantity: '1 pc', category: 'Pipes & Fittings' },
  { name: 'PPR pipe gift', specification: '1/2"', quantity: '1 pc', category: 'Pipes & Fittings' },
  { name: 'Shower pipe', specification: '1 1/2"', quantity: '20 pcs', category: 'Pipes & Fittings' },
  { name: 'Shower pipe', specification: '1"', quantity: '20 pcs', category: 'Pipes & Fittings' },
  { name: 'Shower pipe', specification: '1/2" 4ft', quantity: '5 pcs', category: 'Pipes & Fittings' },
  { name: 'Shower pipe', specification: '1/2" 3ft', quantity: '5 pcs', category: 'Pipes & Fittings' },
  { name: 'Shower pipe', specification: '3/4"', quantity: '4 pcs', category: 'Pipes & Fittings' },

  // ── Valves ──────────────────────────────────────────────────────────────
  { name: 'Min valve', specification: null, quantity: '440 pcs', category: 'Valves' },
  { name: 'High level ball valve', specification: null, quantity: '16 pcs', category: 'Valves' },
  { name: 'Magic valve', specification: '1/2" white', quantity: '10 pcs', category: 'Valves' },
  { name: 'Magic valve', specification: '1 1/4" white', quantity: '10 pcs', category: 'Valves' },
  { name: 'Magic valve', specification: '1 1/2" chrome', quantity: '10 pcs', category: 'Valves' },
  { name: 'Gate valve', specification: '1/2"', quantity: '5 pcs', category: 'Valves' },
  { name: 'Ang valve (Henmed)', specification: null, quantity: '200 pcs', category: 'Valves' },
  { name: 'Neat valve', specification: '12mm', quantity: '4 pcs', category: 'Valves' },
  { name: 'Neat valve', specification: '10mm', quantity: '6 pcs', category: 'Valves' },
  { name: 'Neat valve', specification: '8mm', quantity: '2 pcs', category: 'Valves' },
  { name: 'Neat valve', specification: '6mm', quantity: '2 pcs', category: 'Valves' },
  { name: 'Float valve', specification: null, quantity: '3 pcs', category: 'Valves' },
  { name: 'Automatic control valve', specification: null, quantity: '4 pcs', category: 'Valves' },
  { name: 'Bullcock', specification: '3/4" PVC', quantity: '10 pcs', category: 'Valves' },
  { name: 'Bullcock', specification: '1/2" PVC', quantity: '10 pcs', category: 'Valves' },
  { name: 'Hanks', specification: null, quantity: '3 pcs', category: 'Valves' },

  // ── Bathroom Accessories ────────────────────────────────────────────────
  { name: 'Ena shower', specification: null, quantity: '2 pcs', category: 'Bathroom Accessories' },
  { name: 'Shower rose', specification: null, quantity: '5 pcs', category: 'Bathroom Accessories' },
  { name: 'Arabic toilet', specification: null, quantity: '3 pcs', category: 'Bathroom Accessories' },
  { name: 'Bathroom shelf - Uzuri', specification: null, quantity: '2 pcs', category: 'Bathroom Accessories' },
  { name: 'Soap dish', specification: null, quantity: '4 pcs', category: 'Bathroom Accessories' },
  { name: 'Soap holder', specification: null, quantity: '4 pcs', category: 'Bathroom Accessories' },
  { name: 'Liquid soap holder - wall mount', specification: null, quantity: '3 pcs', category: 'Bathroom Accessories' },
  { name: 'Tissue holder (plastic) - open', specification: null, quantity: '5 pcs', category: 'Bathroom Accessories' },
  { name: 'Tissue holder (chrome)', specification: null, quantity: '5 pcs', category: 'Bathroom Accessories' },
  { name: 'Tissue holder (gold)', specification: null, quantity: '5 pcs', category: 'Bathroom Accessories' },
  { name: 'Toothbrush holder (plastic)', specification: null, quantity: '5 pcs', category: 'Bathroom Accessories' },
  { name: 'Drying rack (dish)', specification: null, quantity: '10 pcs', category: 'Bathroom Accessories' },
  { name: 'Bottle trap (plastic)', specification: null, quantity: '5 pcs', category: 'Bathroom Accessories' },
  { name: 'Bottle trap (stainless)', specification: '1 1/4"', quantity: '5 pcs', category: 'Bathroom Accessories' },
  { name: 'Bottle trap (stainless)', specification: '1 1/2"', quantity: '5 pcs', category: 'Bathroom Accessories' },
  { name: 'Urinal waste', specification: null, quantity: '2 pcs', category: 'Bathroom Accessories' },
  { name: 'Suction top flush', specification: null, quantity: '4 pcs', category: 'Bathroom Accessories' },

  // ── Locks & Security ────────────────────────────────────────────────────
  { name: 'Lock (golden)', specification: null, quantity: '3 pcs', category: 'Locks & Security' },
  { name: 'Lock (silver)', specification: null, quantity: '2 pcs', category: 'Locks & Security' },
  { name: 'Door lock', specification: null, quantity: '3 pcs', category: 'Locks & Security' },

  // ── Tools & Equipment ───────────────────────────────────────────────────
  { name: 'Pipe cutter (small)', specification: null, quantity: '3 pcs', category: 'Tools & Equipment' },
  { name: 'Screwdriver (Lucas)', specification: null, quantity: '5 pcs', category: 'Tools & Equipment' },
  { name: 'Screwdriver (big)', specification: null, quantity: '2 pcs', category: 'Tools & Equipment' },
  { name: 'Self screwdriver', specification: null, quantity: '8 pcs', category: 'Tools & Equipment' },
  { name: '2-in-1 screwdriver', specification: null, quantity: '4 pcs', category: 'Tools & Equipment' },
  { name: 'Solar welding goggles', specification: null, quantity: '4 pcs', category: 'Tools & Equipment' },
  { name: 'Hacksaw', specification: null, quantity: '14 pcs', category: 'Tools & Equipment' },
  { name: 'Chalk line', specification: null, quantity: '5 pcs', category: 'Tools & Equipment' },
  { name: 'Spirit level', specification: null, quantity: '5 pcs', category: 'Tools & Equipment' },
  { name: 'Pliers', specification: null, quantity: '3 pcs', category: 'Tools & Equipment' },
  { name: 'Trowel', specification: null, quantity: '2 pcs', category: 'Tools & Equipment' },
  { name: 'Trowel', specification: '7"', quantity: '1 pc', category: 'Tools & Equipment' },
  { name: 'Chuck key', specification: null, quantity: '2 pcs', category: 'Tools & Equipment' },
  { name: 'Drill bits set', specification: null, quantity: '2 pcs', category: 'Tools & Equipment' },
  { name: 'Drill bits', specification: null, quantity: '2 pcs', category: 'Tools & Equipment' },
  { name: 'Drill bits', specification: '18mm', quantity: '2 pcs', category: 'Tools & Equipment' },
  { name: 'Flat bits', specification: null, quantity: '3 pcs', category: 'Tools & Equipment' },
  { name: 'Jigsaw blades', specification: null, quantity: '4 pcs (set)', category: 'Tools & Equipment' },
  { name: 'Glass cutter', specification: null, quantity: '1 pc', category: 'Tools & Equipment' },
  { name: 'Shovel (flat)', specification: null, quantity: '1 pc', category: 'Tools & Equipment' },
  { name: 'Allen key', specification: '2"', quantity: '1 pc', category: 'Tools & Equipment' },
  { name: 'Chisel', specification: null, quantity: '2 pcs', category: 'Tools & Equipment' },
  { name: 'Pipe wrench', specification: '18"', quantity: '2 pcs', category: 'Tools & Equipment' },
  { name: 'Shackle', specification: null, quantity: '2 pair', category: 'Tools & Equipment' },
  { name: 'Drill', specification: null, quantity: '1 pc', category: 'Tools & Equipment' },
  { name: 'Hand saw', specification: '18"', quantity: '2 pcs', category: 'Tools & Equipment' },
  { name: 'Hand saw', specification: '16"', quantity: '2 pcs', category: 'Tools & Equipment' },
  { name: 'Shears', specification: null, quantity: '3 pcs', category: 'Tools & Equipment' },
  { name: 'Solder wire', specification: null, quantity: '6 pcs', category: 'Tools & Equipment' },
  { name: 'Electrode', specification: null, quantity: '1 pc', category: 'Tools & Equipment' },
  { name: 'Maders (rubber mallet)', specification: null, quantity: '4 pcs', category: 'Tools & Equipment' },
  { name: 'Aloe brush', specification: null, quantity: '19 pcs', category: 'Tools & Equipment' },
  { name: 'Corona brush', specification: null, quantity: '5 pcs', category: 'Tools & Equipment' },
  { name: 'End clothing', specification: null, quantity: '1 pc', category: 'Tools & Equipment' },

  // ── Abrasives & Cutting Discs ───────────────────────────────────────────
  { name: 'Grinding disc', specification: '7"', quantity: '5 pcs', category: 'Abrasives & Cutting Discs' },
  { name: 'Poly disc', specification: null, quantity: '4 pcs', category: 'Abrasives & Cutting Discs' },
  { name: 'Diamond cutting disc', specification: null, quantity: '5 pcs', category: 'Abrasives & Cutting Discs' },
  { name: 'Cutting disc (wood)', specification: '7" Cali', quantity: '3 pcs', category: 'Abrasives & Cutting Discs' },
  { name: 'Cutting disc', specification: '9" Castiel', quantity: '15 pcs', category: 'Abrasives & Cutting Discs' },
  { name: 'Cutting disc (Rhodius)', specification: 'S.L', quantity: '7 pcs', category: 'Abrasives & Cutting Discs' },
  { name: 'Cutting disc', specification: '9" S.L', quantity: '8 pcs', category: 'Abrasives & Cutting Discs' },
  { name: 'Cutting disc (iron)', specification: null, quantity: '5 pcs', category: 'Abrasives & Cutting Discs' },

  // ── Clips & Fasteners ───────────────────────────────────────────────────
  { name: 'Insulating tape (small)', specification: null, quantity: '20 pcs', category: 'Clips & Fasteners' },
  { name: 'Guft clip', specification: null, quantity: '100 pcs', category: 'Clips & Fasteners' },
  { name: 'MTD clip', specification: '1/2"', quantity: '70 pcs', category: 'Clips & Fasteners' },
  { name: 'Metal clip', specification: '1/2"', quantity: '200 pcs', category: 'Clips & Fasteners' },
  { name: 'Binding wire', specification: '20"', quantity: '5 pcs', category: 'Clips & Fasteners' },
  { name: 'Thread seal (large)', specification: null, quantity: '5 pcs', category: 'Clips & Fasteners' },
  { name: 'Thread seal (small)', specification: null, quantity: '2 pkts', category: 'Clips & Fasteners' },
  { name: 'Gypsum screws', specification: null, quantity: '9 pcs', category: 'Clips & Fasteners' },
  { name: 'Screws', specification: '1"', quantity: '3 pcs', category: 'Clips & Fasteners' },
  { name: 'Steel nails', specification: '2"', quantity: '4 pcs', category: 'Clips & Fasteners' },
  { name: 'Self-tapping screws', specification: null, quantity: '3 pkts', category: 'Clips & Fasteners' },
]

async function main() {
  console.log('Seeding products...')
  for (const item of items) {
    await prisma.product.create({ data: item })
  }
  console.log(`Successfully seeded ${items.length} products!`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
