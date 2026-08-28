import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://soul-extractor.jinchongliang.chatgpt.site'),
  title: 'Soul Extractor · 灵魂提取器',
  description: '由 MID-70 点云驱动的数字生命与时间档案。它不是灵魂的证明，而是一份温柔的记录。',
  openGraph: {
    title: 'Soul Extractor · 灵魂提取器',
    description: '把一段存在，留在光里。由 MID-70 点云驱动的数字生命与时间档案。',
    url: 'https://soul-extractor.jinchongliang.chatgpt.site',
    siteName: 'Soul Extractor',
    locale: 'zh_CN',
    type: 'website',
    images: [{
      url: 'https://soul-extractor.jinchongliang.chatgpt.site/og.png',
      width: 1731,
      height: 909,
      alt: 'Soul Extractor 灵魂提取器：把一段存在，留在光里。',
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Soul Extractor · 灵魂提取器',
    description: '把一段存在，留在光里。',
    images: ['https://soul-extractor.jinchongliang.chatgpt.site/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
