import './globals.css'
import type { Metadata } from 'next'
import { AuthProvider } from '@/components/AuthContext'

export const metadata: Metadata = {
  title: 'ASTRA — Federated AI Platform',
  description: 'Enterprise federated learning orchestration and monitoring platform',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
