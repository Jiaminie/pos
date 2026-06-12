import { prisma } from '@/lib/server/db'

const SINGLETON_ID = 'singleton'

export async function GET() {
  try {
    const settings = await prisma.storeSettings.upsert({
      where: { id: SINGLETON_ID },
      update: {},
      create: { id: SINGLETON_ID },
    })
    return Response.json({ data: settings, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json()
    const { companyName, tagline, logoDataUrl, primaryColor, currency, footerText, minMarkupPercent } = body

    const settings = await prisma.storeSettings.upsert({
      where: { id: SINGLETON_ID },
      update: {
        ...(companyName  !== undefined && { companyName }),
        ...(tagline      !== undefined && { tagline }),
        ...(logoDataUrl  !== undefined && { logoDataUrl }),
        ...(primaryColor !== undefined && { primaryColor }),
        ...(currency     !== undefined && { currency }),
        ...(footerText   !== undefined && { footerText }),
        ...(minMarkupPercent !== undefined && { minMarkupPercent }),
      },
      create: {
        id: SINGLETON_ID,
        companyName:  companyName  ?? 'My Business',
        tagline:      tagline      ?? '',
        logoDataUrl:  logoDataUrl  ?? '',
        primaryColor: primaryColor ?? '#2563eb',
        currency:     currency     ?? 'KES',
        footerText:   footerText   ?? 'Thank you for your business.',
        minMarkupPercent: minMarkupPercent ?? 150,
      },
    })
    return Response.json({ data: settings, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}
