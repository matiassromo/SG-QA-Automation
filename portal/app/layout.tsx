import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import './dialog.css';
import './explorer.css';
import './context.css';
import './requirements.css';
import './rfc.css';
import './azure-attachments.css';
import './test-design.css';
import './automation.css';
import './automation-setup.css';
import './test-plans.css';
import './design-preparation.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'SG QA Control',
  description: 'Portal interno para cobertura, ejecución y evidencias de pruebas en Azure DevOps.',
  openGraph: {
    title: 'SG QA Control',
    description: 'Automation · Azure DevOps · Evidence',
    images: ['/sg-qa-control-social-preview.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
