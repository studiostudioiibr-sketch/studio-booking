import type { Metadata } from 'next'
import { DM_Serif_Display, DM_Sans } from 'next/font/google'
import './globals.css'

const dmSerif = DM_Serif_Display({
  weight: ['400'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-display',
})

const dmSans = DM_Sans({
  weight: ['300', '400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-body',
})

export const metadata: Metadata = {
  title: 'Studio II — Reserve sua Sessão',
  description: 'Sessões fotográficas editoriais no Rio de Janeiro. Agende seu horário online.',
  openGraph: {
    title: 'Studio II — Reserve sua Sessão',
    description: 'Sessões fotográficas editoriais no Rio de Janeiro.',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-br">
      <body className={`${dmSerif.variable} ${dmSans.variable} font-body bg-paper text-ink antialiased`}>
        {children}
      </body>
    </html>
  )
}
