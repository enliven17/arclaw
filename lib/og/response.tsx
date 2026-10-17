/** One way to turn a frame into a PNG: brand fonts, 1200x630, extra headers per route. */
import type { ReactElement } from "react";
import { ImageResponse } from "next/og";
import { ogFonts } from "./assets";
import { OG_SIZE } from "./frame";

export async function ogResponse(element: ReactElement, headers: Record<string, string> = {}): Promise<ImageResponse> {
  return new ImageResponse(element, { ...OG_SIZE, fonts: await ogFonts(), headers });
}
