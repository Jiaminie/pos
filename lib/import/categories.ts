/** Infer product category from name when the export uses a placeholder like "ALL ITEMS". */
export function inferCategory(name: string): string {
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
  if (/hdpe|cpvc|ppr|pipe|elbow|tee|socket|plug|bend|union|bush|nipple|connector/.test(n))
    return 'Pipes & Fittings'
  return 'General'
}

const PLACEHOLDER_CATEGORIES = new Set(['all items', 'general', ''])

export function resolveCategory(categoryRaw: string, productName: string): string {
  const raw = categoryRaw.trim()
  if (!raw || PLACEHOLDER_CATEGORIES.has(raw.toLowerCase())) {
    return inferCategory(productName)
  }
  return titleCaseCategory(raw)
}

function titleCaseCategory(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
