// Maps NextAuth's `?error=` codes to a readable message. NextAuth appends
// this query param when it redirects back to `pages.signIn` ("/login")
// after an OAuth sign-in fails. Neither LoginForm nor RegisterForm read
// this today, which is why a failed Google sign-in just looks like the
// page silently reloaded with no explanation.
export function googleErrorMessage(code: string | null): string {
  switch (code) {
    case "OAuthAccountNotLinked":
      return "That email is already registered with a password. Log in with your password, or link Google from your account settings.";
    case "OAuthSignin":
    case "OAuthCallback":
      return "We couldn't reach Google to sign you in. Please try again.";
    case "OAuthCreateAccount":
    case "AdapterError":
      return "We couldn't create your account. Please try again or contact support.";
    case "AccessDenied":
      return "Google sign-in was cancelled.";
    case "Configuration":
      return "Google sign-in isn't set up correctly. Please contact support.";
    default:
      return "";
  }
}