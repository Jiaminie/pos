'use client'

import { useEffect, useState } from 'react'
import { getAll as getCategories } from '@/lib/db/categories'
import { getAll as getProducts } from '@/lib/db/products'
import { seedIfEmpty } from '@/lib/db/seed'
import CategoryModal from '@/components/CategoryModal'
import type { ProductCategory } from '@/lib/types'

export default function CategoriesPage() {
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [countMap, setCountMap] = useState<Record<string, number>>({})
  const [selected, setSelected] = useState<ProductCategory | null>(null)

  useEffect(() => {
    async function load() {
      await seedIfEmpty()
      const [cats, prods] = await Promise.all([getCategories(), getProducts()])
      setCategories(cats)
      const counts: Record<string, number> = {}
      for (const p of prods) {
        counts[p.categoryId] = (counts[p.categoryId] ?? 0) + 1
      }
      setCountMap(counts)
    }
    load()
  }, [])

  return (
    <div className="flex-1 overflow-y-auto p-6">
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold tracking-tight mb-6">Categories</h1>

      {categories.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-gray-500">
          <p className="text-sm">No categories yet — add a category when creating a product</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelected(cat)}
              className="text-left border border-gray-200 rounded-xl p-5 hover:border-blue-400 hover:bg-blue-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <p className="font-semibold text-gray-900">{cat.name}</p>
              <p className="text-sm text-gray-500 mt-1">
                {countMap[cat.id] ?? 0} product{(countMap[cat.id] ?? 0) !== 1 ? 's' : ''}
              </p>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <CategoryModal category={selected} onClose={() => setSelected(null)} />
      )}
    </div>
    </div>
  )
}
