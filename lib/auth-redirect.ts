export function shouldRedirectHomeAfterSignIn(pathname: string): boolean {
  if (!pathname || pathname === "/") return false;
  if (pathname === "/reset-password" || pathname.startsWith("/reset-password")) return false;
  return true;
}
