import type { Metadata } from "next";
import RecapPage from "./recap-page";

type RecapRouteProps = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: RecapRouteProps): Promise<Metadata> {
  const { code } = await params;
  const roomCode = code.toUpperCase();
  const title = `Hall of Fame · HackMusic room ${roomCode}`;
  const description = `Final scores, awards, receipts, and the full playlist for HackMusic room ${roomCode}.`;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, images: [] },
    twitter: { title, description, images: [] },
  };
}

export default async function RecapRoute({ params }: RecapRouteProps) {
  const { code } = await params;
  return <RecapPage code={code.toUpperCase()} />;
}
