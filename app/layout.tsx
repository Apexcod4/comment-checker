import type { Metadata } from "next";
import { Anton, Archivo, Space_Mono } from "next/font/google";
import Starfield from "@/components/Starfield";
import "./globals.css";

const anton = Anton({
  variable: "--font-display",
  weight: "400",
  subsets: ["latin"],
});

const archivo = Archivo({
  variable: "--font-body",
  subsets: ["latin"],
});

const spaceMono = Space_Mono({
  variable: "--font-data",
  weight: ["400", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Comment Intelligence — Signal Scanner",
  description:
    "Scan a post's comments and separate real signal from spam noise.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${anton.variable} ${archivo.variable} ${spaceMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-void text-paper">
        <Starfield />
        {children}
      </body>
    </html>
  );
}
