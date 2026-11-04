import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TanyaHR — Demo PT Demo Rekayasa Indonesia",
  description:
    "Asisten informasi kebijakan HR berbasis dokumen. Demo dengan dokumen perusahaan fiktif.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
