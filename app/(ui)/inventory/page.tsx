import { redirect } from 'next/navigation'

/** Inventory merged into Products — keep old links working. */
export default function InventoryPage() {
  redirect('/products?stock=low')
}
