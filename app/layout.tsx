import type { Metadata } from 'next'
import { Suspense } from 'react'
import { DM_Serif_Display, DM_Sans } from 'next/font/google'
import Script from 'next/script'
import { MetaPageViewTracker } from '@/app/meta-pageview-tracker'
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
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID

  return (
    <html lang="pt-br">
      <body className={`${dmSerif.variable} ${dmSans.variable} font-body bg-paper text-ink antialiased`}>
        {pixelId && (
          <>
            <Script id="meta-pixel-base" strategy="afterInteractive">
              {`
                !function(f,b,e,v,n,t,s)
                {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                n.callMethod.apply(n,arguments):n.queue.push(arguments)};
                if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
                n.queue=[];t=b.createElement(e);t.async=!0;
                t.src=v;s=b.getElementsByTagName(e)[0];
                s.parentNode.insertBefore(t,s)}(window, document,'script',
                'https://connect.facebook.net/en_US/fbevents.js');
                fbq('init', '${pixelId}');
                fbq('track', 'PageView');
              `}
            </Script>
            <noscript>
              <img
                height="1"
                width="1"
                style={{ display: 'none' }}
                src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`}
                alt=""
              />
            </noscript>
            <Suspense fallback={null}>
              <MetaPageViewTracker />
            </Suspense>
          </>
        )}
        {children}
      </body>
    </html>
  )
}
