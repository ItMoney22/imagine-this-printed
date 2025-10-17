import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";

export default function AuthCallback() {
  const [msg, setMsg] = useState("Completing sign in…");
  const [detail, setDetail] = useState<string>("");
  const nav = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const href = window.location.href;
        console.log("[callback] 1️⃣ Full URL:", href);
        console.log("[callback] 📍 Origin:", window.location.origin);
        console.log("[callback] 📍 Pathname:", window.location.pathname);
        console.log("[callback] 📍 Search:", window.location.search);
        console.log("[callback] 📍 Hash:", window.location.hash);

        const url = new URL(href);

        // 1) PKCE: code in query string
        const code = url.searchParams.get("code");

        // 2) Implicit: access_token/refresh_token may be in hash OR query
        const paramsFromHash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const paramsFromQuery = url.searchParams;

        const access_token =
          paramsFromHash.get("access_token") ||
          paramsFromQuery.get("access_token");

        const refresh_token =
          paramsFromHash.get("refresh_token") ||
          paramsFromQuery.get("refresh_token");

        console.log("[callback] 🔍 Detected params:", {
          code: !!code,
          access_token: !!access_token,
          refresh_token: !!refresh_token,
          source: access_token ? (paramsFromHash.get("access_token") ? 'hash' : 'query') : 'none'
        });

        // Get the intended redirect path (saved before OAuth redirect)
        const returnTo = localStorage.getItem("auth_return_to") || "/";
        console.log("[callback] 🎯 Return path:", returnTo);

        if (code) {
          console.log("[callback] 2️⃣ Found code in query → exchangeCodeForSession (PKCE flow)");
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            console.error("[callback] ❌ exchangeCodeForSession error:", error);
            throw error;
          }
          console.log("[callback] 3️⃣ PKCE SUCCESS → session:", !!data?.session, "user.id:", data?.session?.user?.id);
        } else if (access_token && refresh_token) {
          console.log("[callback] 2️⃣ Found tokens → setSession (implicit flow)");
          const { data, error } = await supabase.auth.setSession({
            access_token,
            refresh_token
          });
          if (error) {
            console.error("[callback] ❌ setSession error:", error);
            throw error;
          }
          console.log("[callback] 3️⃣ Implicit SUCCESS → session:", !!data?.session, "user.id:", data?.session?.user?.id);
        } else {
          // Fallback: try to get existing session (e.g., for password reset flows)
          console.log("[callback] 2️⃣ No code or tokens, checking for existing session...");
          const { data: { session }, error } = await supabase.auth.getSession();
          if (error || !session) {
            throw new Error("No auth code, tokens, or existing session found");
          }
          console.log("[callback] 3️⃣ Found existing session, user.id:", session.user.id);
        }

        // Small delay to ensure localStorage persistence completes
        await new Promise(resolve => setTimeout(resolve, 150));

        // Verify session was properly set
        const { data: { session } } = await supabase.auth.getSession();
        console.log("[callback] 4️⃣ Final session check:", !!session, "user.id:", session?.user?.id);

        if (!session) {
          throw new Error("No session found after auth exchange");
        }

        // Verify persisted to localStorage with our custom storageKey
        const storageKey = `itp-auth-v1`;
        const storedAuth = localStorage.getItem(storageKey);
        console.log("[callback] 5️⃣ Storage verification:");
        console.log("  - storageKey:", storageKey);
        console.log("  - has stored data:", !!storedAuth);

        if (storedAuth) {
          try {
            const parsed = JSON.parse(storedAuth);
            console.log("  - has access_token:", !!parsed?.access_token);
            console.log("  - has refresh_token:", !!parsed?.refresh_token);
          } catch (e) {
            console.warn("  - failed to parse stored auth:", e);
          }
        }

        if (!storedAuth) {
          console.warn("[callback] ⚠️ Session exists but not in localStorage! Forcing refresh...");
          const { data: { session: refreshedSession }, error: refreshError } = await supabase.auth.refreshSession();
          if (refreshError) {
            console.error("[callback] ❌ Refresh error:", refreshError);
          } else {
            console.log("[callback] 6️⃣ Forced refresh complete, session:", !!refreshedSession);
          }
        }

        // Verify the user can actually be fetched
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        console.log("[callback] 7️⃣ User verification:", !!user, "error:", userError?.message);

        if (!user) {
          throw new Error("Session exists but user cannot be fetched");
        }

        // Clean URL (remove auth params and hash)
        window.history.replaceState({}, '', window.location.pathname);
        console.log("[callback] 🧹 URL cleaned");

        // Clear return path from localStorage
        localStorage.removeItem("auth_return_to");

        setMsg("Signed in successfully! Redirecting…");
        console.log("[callback] 8️⃣ Navigating to:", returnTo);

        // Small delay to show success message
        await new Promise(resolve => setTimeout(resolve, 500));
        nav(returnTo, { replace: true });

      } catch (err: any) {
        console.error("[callback] ❌ FATAL ERROR:", err);
        console.error("[callback] Error stack:", err?.stack);
        setMsg("We couldn't complete sign in.");
        setDetail(err?.message || String(err));

        // Show error for 3 seconds, then redirect to login
        setTimeout(() => {
          console.log("[callback] ⏱️ Error timeout, redirecting to login...");
          nav("/login", { replace: true });
        }, 3000);
      }
    })();
  }, [nav]);

  return (
    <div style={{ padding: "4rem", textAlign: "center" }}>
      <h2>{msg}</h2>
      {detail && (
        <div>
          <pre style={{
            color: "crimson",
            whiteSpace: "pre-wrap",
            background: "#fee",
            padding: "1rem",
            borderRadius: "8px",
            margin: "1rem auto",
            maxWidth: "600px",
            textAlign: "left"
          }}>
            {detail}
          </pre>
          <p style={{ fontSize: "0.875rem", color: "#666" }}>
            Redirecting to login in 3 seconds...
          </p>
        </div>
      )}
    </div>
  );
}
