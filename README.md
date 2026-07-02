# POS - Point of Sale System

A modern, full-featured Point of Sale (POS) system built with Next.js, React, and TypeScript. This application provides comprehensive inventory management, transaction tracking, and offline-first capabilities for retail businesses.

**Live Demo:** [pos-five-red.vercel.app](https://pos-five-red.vercel.app)

## 🎯 Features

- **Product Management**: Add, update, and manage products with SKU, pricing, and categories
- **Inventory Tracking**: Real-time inventory management with transaction history
- **Multi-Device Support**: Sync inventory across multiple devices with conflict resolution
- **Offline-First Architecture**: Full functionality even without internet connection using IndexedDB
- **Transaction Management**: Track sales, purchases, adjustments, and returns
- **Customizable Settings**: Configure company branding, colors, currency, and receipt templates
- **Receipt Generation**: Generate and print professional receipts with jsPDF
- **Email Integration**: Send receipts via email using Resend
- **Image Management**: Upload and manage product images via Cloudinary
- **Responsive UI**: Beautiful, intuitive interface built with Radix UI and Tailwind CSS

## 🛠️ Tech Stack

### Frontend
- **Framework**: [Next.js 16](https://nextjs.org) - React framework with App Router
- **UI Components**: [Radix UI](https://radix-ui.com) - Accessible component library
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com) - Utility-first CSS framework
- **Icons**: [Lucide React](https://lucide.dev) - Beautiful icon library
- **PDF Generation**: [jsPDF](https://jspdf.dev) with [AutoTable](https://github.com/parallax/jspdf-autotable)
- **Offline Storage**: [Dexie.js](https://dexie.org) - IndexedDB wrapper
- **Notifications**: [Sonner](https://sonner.emilkowal.ski) - Toast notifications

### Backend
- **Database**: [PostgreSQL](https://www.postgresql.org) with [Prisma](https://www.prisma.io) ORM
- **Driver**: [pg](https://node-postgres.com) - PostgreSQL client
- **ORM**: [Prisma](https://www.prisma.io) with PostgreSQL adapter

### Services
- **Image Storage**: [Cloudinary](https://cloudinary.com) - Cloud image management
- **Email**: [Resend](https://resend.com) - Transactional email service
- **Deployment**: [Vercel](https://vercel.com)

### Development
- **Language**: [TypeScript](https://www.typescriptlang.org) - Type-safe JavaScript
- **Linting**: [ESLint 9](https://eslint.org)
- **Runtime**: [tsx](https://tsx.is) - TypeScript executor

## 📊 Database Schema

### Products
- Store product details including name, SKU, pricing, category, and images
- Track cost price and selling price for margin calculations

### Inventory Transactions
- Record all inventory movements (sales, purchases, adjustments, returns)
- Link transactions to specific products and devices
- Track sync status for offline-first functionality

### Devices
- Manage multiple POS terminals
- Track last sync timestamp for conflict resolution

### Store Settings
- Centralized configuration for company branding, colors, and receipt customization
- Support for custom currencies and business information

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ 
- npm, yarn, pnpm, or bun
- PostgreSQL database
- Cloudinary account (for image uploads)
- Resend API key (for email functionality)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/saidimuKennedy/pos.git
   cd pos
   ```

2. **Install dependencies**
   ```bash
   npm install
   # or
   yarn install
   # or
   pnpm install
   # or
   bun install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   ```
   Edit `.env.local` with your values:
   ```env
   DATABASE_URL=postgresql://user:password@localhost:5432/pos_db
   CLOUDINARY_CLOUD_NAME=your_cloud_name
   CLOUDINARY_API_KEY=your_api_key
   CLOUDINARY_API_SECRET=your_api_secret
   ANTHROPIC_API_KEY=your_anthropic_api_key
   RESEND_API_KEY=your_resend_api_key
   ```

   Verify prerequisites: `npm run verify:phase0` (add `--require-cloudinary` once Cloudinary creds are set).

4. **Set up the database**
   ```bash
   npx prisma migrate dev --name init
   npx prisma generate
   ```

5. **Run the development server**
   ```bash
   npm run dev
   # or
   yarn dev
   # or
   pnpm dev
   # or
   bun dev
   ```

6. **Open your browser**
   Navigate to [http://localhost:3000](http://localhost:3000) to see the application

## 📝 Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production (generates Prisma client and builds Next.js)
- `npm start` - Start production server
- `npm run lint` - Run ESLint to check code quality
- `npm run verify:phase0` … `npm run verify:phase6` - Stock count plan phase gates (see `docs/plans/stock-count.md`)
- `npm run verify:stock-count` - Phase 7 final gate (unit/static checks + runs phase0–6; pass `--skip-phases` to skip subprocesses)

## 🏗️ Project Structure

```
pos/
├── app/              # Next.js App Router pages and layouts
├── components/       # Reusable React components
├── lib/             # Utility functions and helpers
├── prisma/          # Database schema and migrations
├── public/          # Static assets
├── styles/          # Global styles
├── package.json     # Dependencies and scripts
└── tsconfig.json    # TypeScript configuration
```

## 🔄 Offline-First Architecture

The application uses an offline-first approach:

1. **Local Storage**: All data is cached in IndexedDB using Dexie.js
2. **Sync Queue**: Transactions are queued when offline
3. **Auto Sync**: When connection is restored, changes are automatically synced to the server
4. **Conflict Resolution**: Device ID helps resolve conflicts during multi-device sync

## 🌍 Multi-Device Synchronization

- Each device has a unique ID
- Transactions include the device ID for tracking
- `lastSyncAt` timestamp helps identify which changes need sync
- Centralized PostgreSQL database acts as the source of truth

## 🎨 Customization

The store settings allow you to customize:
- **Company Name**: Display name in receipts
- **Tagline**: Business tagline
- **Logo**: Upload custom logo (stored as data URL)
- **Primary Color**: Theme color for the UI
- **Currency**: Set your local currency (default: KES)
- **Footer Text**: Custom message on receipts

## 🔐 Security Considerations

- Environment variables for sensitive credentials
- Type-safe database queries with Prisma
- Server-side validation and authentication (recommended to implement)
- HTTPS enforced in production

## 📦 Deployment

### Deploy on Vercel (Recommended)

The easiest way to deploy is to use the [Vercel Platform](https://vercel.com/new):

1. Push your code to GitHub
2. Import the repository on Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

See [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is open source and available under the MIT License.

## 🆘 Support

For issues, questions, or suggestions, please open an issue on the [GitHub repository](https://github.com/saidimuKennedy/pos/issues).

## 📚 Additional Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Radix UI Components](https://radix-ui.com/docs/primitives/overview/introduction)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [TypeScript Handbook](https://www.typescriptlang.org/docs)

---

**Built with ❤️ by [saidimuKennedy](https://github.com/saidimuKennedy)**
