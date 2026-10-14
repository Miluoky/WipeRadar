import { NextResponse, type NextRequest } from "next/server";
import { hasLocale, pickLocale } from "./i18n";

/** "/" and other locale-less paths → /ru/... or /en/... (cookie first, then Accept-Language). */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const first = pathname.split("/")[1];
  if (hasLocale(first)) return;

  const saved = request.cookies.get("locale")?.value;
  const locale = saved && hasLocale(saved) ? saved : pickLocale(request.headers.get("accept-language"));
  request.nextUrl.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(request.nextUrl);
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|icon|apple-icon|robots.txt|sitemap.xml|.*\\..*).*)"],
};
