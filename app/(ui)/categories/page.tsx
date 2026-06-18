'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { getAll as getCategories } from '@/lib/db/categories'
import { getAll as getProducts } from '@/lib/db/products'
import { seedIfEmpty, syncFromServer } from '@/lib/db/seed'
import { getBrandOptions, getProductBrand } from '@/lib/brands'
import { normalizeQuery } from '@/lib/normalize'
import { CategoryPicker } from '@/components/pos/CategoryPicker'
import BrandModal from '@/components/BrandModal'
import type { Product, ProductCategory } from '@/lib/types'

export default function CategoriesPage() {
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null)
  const [filterCategoryId, setFilterCategoryId] = useState<string>('all')
  const [search, setSearch] = useState('')

  async function refreshLocal() {
    const [cats, prods] = await Promise.all([getCategories(), getProducts()])
    setCategories(cats)
    setProducts(prods)
  }

  useEffect(() => {
    async function load() {
      const [cats, prods] = await Promise.all([getCategories(), getProducts()])
      if (prods.length > 0) {
        setCategories(cats)
        setProducts(prods)
      } else {
        await seedIfEmpty()
        await refreshLocal()
      }
      const synced = await syncFromServer()
      if (synced) await refreshLocal()
    }
    load()
  }, [])

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: products.length }
    for (const p of products) counts[p.categoryId] = (counts[p.categoryId] ?? 0) + 1
    return counts
  }, [products])

  const scopedProducts = useMemo(
    () => products.filter((p) => filterCategoryId === 'all' || p.categoryId === filterCategoryId),
    [products, filterCategoryId],
  )

  const brands = useMemo(() => getBrandOptions(scopedProducts), [scopedProducts])

  const brandCounts = useMemo(() => {
    const counts: Record<string, number> = { all: scopedProducts.length }
    for (const product of scopedProducts) {
      const brand = getProductBrand(product)
      counts[brand] = (counts[brand] ?? 0) + 1
    }
    return counts
  }, [scopedProducts])

  const nq = normalizeQuery(search.trim())
  const visibleBrands = brands.filter((b) => !nq || normalizeQuery(b).includes(nq))

  return (
    <div className="flex-1 overflow-y-auto p-6">
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Brands</h1>
      <p className="text-sm text-gray-500 mb-6">Browse products grouped by brand{categories.length > 0 ? ' — filter by category below' : ''}</p>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1 min-w-0">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search brands…"
            className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 focus:bg-white transition-colors"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
        </div>
        {categories.length > 0 && (
          <CategoryPicker
            categories={categories}
            counts={categoryCounts}
            value={filterCategoryId}
            onChange={setFilterCategoryId}
          />
        )}
      </div>

      {visibleBrands.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-gray-500">
          {search
            ? <>
                <p className="text-sm font-medium">No results for &ldquo;{search}&rdquo;</p>
                <button onClick={() => setSearch('')} className="mt-2 text-xs text-blue-600 hover:underline">Clear search</button>
              </>
            : <p className="text-sm">No brands yet — add a brand when creating a product</p>
          }
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {visibleBrands.map((brand) => (
            <button
              key={brand}
              onClick={() => setSelectedBrand(brand)}
              className="text-left border border-gray-200 rounded-xl p-5 hover:border-blue-400 hover:bg-blue-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <p className="font-semibold text-gray-900">{brand}</p>
              <p className="text-sm text-gray-500 mt-1">
                {brandCounts[brand] ?? 0} product{(brandCounts[brand] ?? 0) !== 1 ? 's' : ''}
              </p>
            </button>
          ))}
        </div>
      )}

      {selectedBrand && (
        <BrandModal
          brand={selectedBrand}
          categoryId={filterCategoryId === 'all' ? null : filterCategoryId}
          onClose={() => setSelectedBrand(null)}
        />
      )}
    </div>
    </div>
  )
}
