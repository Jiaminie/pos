'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { getAll as getProducts } from '@/lib/db/products'
import { getProductBrand } from '@/lib/brands'
import type { Product } from '@/lib/types'

interface Props {
  brand: string
  categoryId?: string | null
  onClose: () => void
}

export default function BrandModal({ brand, categoryId, onClose }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getProducts().then((rows) => {
      let filtered = rows.filter((p) => getProductBrand(p) === brand)
      if (categoryId) filtered = filtered.filter((p) => p.categoryId === categoryId)
      setProducts(filtered)
    })
  }, [brand, categoryId])

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose()
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{brand}</h2>
            <p className="text-sm text-gray-500 mt-0.5">{products.length} product{products.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {products.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-16">No products for this brand</p>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {products.map((p) => (
                <div key={p.id} className="border border-gray-200 rounded-xl overflow-hidden">
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.imageUrl}
                      alt={p.name}
                      className="w-full object-cover"
                      style={{ aspectRatio: '4/3' }}
                    />
                  ) : (
                    <div
                      className="w-full bg-gray-100 flex items-center justify-center"
                      style={{ aspectRatio: '4/3' }}
                    >
                      <Camera size={28} className="text-gray-400" />
                    </div>
                  )}
                  <div className="p-3">
                    <p className="font-bold text-sm text-gray-900 leading-snug">{p.name}</p>
                    <p className="text-gray-500 mt-0.5" style={{ fontSize: 13 }}>KES {p.sellingPrice.toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="w-full py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
