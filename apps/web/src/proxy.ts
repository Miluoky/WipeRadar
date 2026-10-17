import { NextResponse, type NextRequest } from "next/server";
import { hasLocale, pickLocale } from "./i18n";

const isDev = process.env.NODE_ENV === "development";

/**
 * Nonce-based CSP. Next reads the nonce from the request header and stamps it on its own scripts;
 * 'strict-dynamic' lets those load the lazy chunks (three.js hero included). JSON-LD blocks are
 * data, not script, so they need no nonce. Styles stay 'unsafe-inline' because React style={{}}
 * attributes (chart bars, progress, badges) can't carry a nonce. Images come from whatever host a
 * server owner puts in logoimage/headerimage/map_image_url, hence https: for img-src.
 */
function contentSecurityPolicy(nonce: string) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/**
 * "/" and other locale-less paths → /ru/... or /en/... (cookie first, then Accept-Language).
 * Localized pages get a fresh CSP nonce per request.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const first = pathname.split("/")[1];
  if (!hasLocale(first)) {
    const saved = request.cookies.get("locale")?.value;
    const locale = saved && hasLocale(saved) ? saved : pickLocale(request.headers.get("accept-language"));
    request.nextUrl.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
    return NextResponse.redirect(request.nextUrl);
  }

  const nonce = btoa(crypto.randomUUID());
  const policy = contentSecurityPolicy(nonce);
  const headers = new Headers(request.headers);
  headers.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|icon|apple-icon|robots.txt|sitemap.xml|.*\\..*).*)"],
};
