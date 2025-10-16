import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } } // we handle URL explicitly
);

export default function AuthCallback() {
  const [msg, setMsg] = useState("Completing sign in…");
  const [detail, setDetail] = useState<string>("");
  const nav = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const href = window.location.href;
        console.log("[callback] href", href);
        const url = new URL(href);

        const code = url.searchParams.get("code");
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const access_token = hash.get("access_token");
        const refresh_token = hash.get("refresh_token");

        if (code) {
          console.log("[callback] found code -> exchangeCodeForSession");
          const { data, error } = await supabase.auth.exchangeCodeForSession(href);
          if (error) throw error;
          console.log("[callback] exchange ok", !!data?.session);
        } else if (access_token && refresh_token) {
          console.log("[callback] found hash tokens -> setSession");
          const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) throw error;
          console.log("[callback] setSession ok", !!data?.session);
          // Clean the hash to avoid reprocessing on refresh
          history.replaceState(null, "", window.location.pathname + window.location.search);
        } else {
          throw new Error("No auth code or hash tokens present");
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("No session after handling URL");

        // Verify localStorage persisted
        const key = Object.keys(localStorage).find(k => k.startsWith("sb-") && k.endsWith("-auth-token"));
        console.log("[callback] storage key:", key, "has token?", !!key && !!JSON.parse(localStorage.getItem(key) || "{}")?.currentSession?.access_token);

        setMsg("Signed in. Redirecting…");
        nav("/", { replace: true });
      } catch (err: any) {
        console.error("[callback] error:", err);
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
