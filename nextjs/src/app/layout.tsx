import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Cipher Music',
  description: 'Stream music with Cipher — your personal music player',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Cipher' },
};

export const viewport: Viewport = {
  themeColor: '#00d4ff',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
