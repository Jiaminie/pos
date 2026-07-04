import { prisma } from '@/lib/server/db'
import { defaultPosLookupMode, parsePosLookupMode, parseReceiptFormat } from '@/lib/settings'
import { requireUser, isAuthUser, requireUserWithPermission } from '@/lib/server/auth/guard'

const SINGLETON_ID = 'singleton'

export async function GET() {
  const user = await requireUser()
  if (!isAuthUser(user)) return user

  try {
    const settings = await prisma.storeSettings.upsert({
      where: { id: SINGLETON_ID },
      update: {},
      create: { id: SINGLETON_ID, posLookupMode: defaultPosLookupMode() },
    })
    return Response.json({ data: settings, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  const user = await requireUserWithPermission(undefined, 'admin.settings')
  if (!isAuthUser(user)) return user

  try {
    const body = await req.json()
    const { companyName, tagline, logoDataUrl, primaryColor, currency, footerText, minMarkupPercent, posLookupMode, receiptFormat, receiptTitle, paymentDetails, resendApiKey, reportEmail, fromEmail } = body

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
        ...(posLookupMode !== undefined && { posLookupMode: parsePosLookupMode(posLookupMode) }),
        ...(receiptFormat !== undefined && { receiptFormat: parseReceiptFormat(receiptFormat) }),
        ...(receiptTitle  !== undefined && { receiptTitle: String(receiptTitle).slice(0, 40) }),
        ...(paymentDetails !== undefined && { paymentDetails: String(paymentDetails).slice(0, 500) }),
        ...(resendApiKey  !== undefined && { resendApiKey: String(resendApiKey) }),
        ...(reportEmail   !== undefined && { reportEmail:  String(reportEmail) }),
        ...(fromEmail     !== undefined && { fromEmail:    String(fromEmail) }),
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
        posLookupMode: parsePosLookupMode(posLookupMode ?? defaultPosLookupMode()),
        receiptFormat: parseReceiptFormat(receiptFormat),
        receiptTitle: receiptTitle ? String(receiptTitle).slice(0, 40) : 'RECEIPT',
        paymentDetails: paymentDetails != null ? String(paymentDetails).slice(0, 500) : '',
        resendApiKey: resendApiKey ?? '',
        reportEmail:  reportEmail  ?? '',
        fromEmail:    fromEmail    ?? '',
      },
    })
    return Response.json({ data: settings, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}
