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
        console.log("[callback] 1️⃣ href", href);
        const url = new URL(href);

        const code = url.searchParams.get("code");
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const access_token = hash.get("access_token");
        const refresh_token = hash.get("refresh_token");

        if (code) {
          console.log("[callback] 2️⃣ found code -> exchangeCodeForSession (PKCE)");
          const { data, error } = await supabase.auth.exchangeCodeForSession(href);
          if (error) {
            console.error("[callback] ❌ exchangeCodeForSession error:", error);
            throw error;
          }
          console.log("[callback] 3️⃣ exchangeCodeForSession SUCCESS, session?", !!data?.session);
        } else if (access_token && refresh_token) {
          console.log("[callback] 2️⃣ found hash tokens -> setSession (implicit)");
          const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) {
            console.error("[callback] ❌ setSession error:", error);
            throw error;
          }
          console.log("[callback] 3️⃣ setSession SUCCESS, session?", !!data?.session, "user.id:", data?.session?.user?.id);
          // Clean hash to avoid reprocessing
          history.replaceState(null, "", window.location.pathname + window.location.search);
        } else {
          throw new Error("No auth code or hash tokens present");
        }

        // Small delay to ensure localStorage persistence completes
        await new Promise(resolve => setTimeout(resolve, 100));

        const { data: { session } } = await supabase.auth.getSession();
        console.log("[callback] 4️⃣ getSession result:", !!session, "user.id:", session?.user?.id);
        if (!session) throw new Error("No session after handling URL");

        // Verify persisted to localStorage
        const key = Object.keys(localStorage).find(k => k.startsWith("sb-") && k.endsWith("-auth-token"));
        const hasToken = !!key && !!JSON.parse(localStorage.getItem(key) || "{}")?.currentSession?.access_token;
        console.log("[callback] 5️⃣ localStorage key:", key, "has token?", hasToken);

        if (!hasToken) {
          console.warn("[callback] ⚠️ Session exists but not in localStorage! Forcing storage...");
          // Force refresh to ensure persistence
          const { data: { session: refreshedSession }, error: refreshError } = await supabase.auth.refreshSession();
          if (refreshError) console.error("[callback] refresh error:", refreshError);
          else console.log("[callback] 6️⃣ Forced refresh, session?", !!refreshedSession);
        }

        setMsg("Signed in. Redirecting…");
        console.log("[callback] 7️⃣ Navigating to home...");
        nav("/", { replace: true });
      } catch (err: any) {
        console.error("[callback] ❌ FATAL ERROR:", err);
        setMsg("We couldn't complete sign in.");
        setDetail(err?.message || String(err));
      }
    })();
  }, [nav]);

  return (
    <div style={{ padding: "4rem", textAlign: "center" }}>
      <h2>{msg}</h2>
      {detail && <pre style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{detail}</pre>}
    </div>
  );
}
